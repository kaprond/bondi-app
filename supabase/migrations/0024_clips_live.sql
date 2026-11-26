-- 0024: clip feed goes live (AI originals), crew clips (video pools), paid-creator waitlist.

-- 1. Storage for the public feed. Teasers are public (they stop before the outcome);
--    reveals are private and only handed out by the reveal-url function after a call.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teasers', 'teasers', true, 52428800, array['video/mp4', 'image/jpeg']),
       ('reveals', 'reveals', false, 52428800, array['video/mp4'])
on conflict (id) do nothing;

-- Key for the ingest-clip function (service-side upload of LetsJam originals).
insert into public.app_secrets (name, value)
values ('ingest', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

-- 2. Crew clips: a pool can carry a setup video (filmed up to the moment) and a reveal video.
--    Private bucket, readable by the crew only. Only the pool's creator uploads.
alter table public.pools add column if not exists clip_path text;
alter table public.pools add column if not exists reveal_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pool-clips', 'pool-clips', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

drop policy if exists pool_clip_upload on storage.objects;
create policy pool_clip_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'pool-clips'
  and exists (select 1 from public.pools p where p.id::text = (storage.foldername(name))[1]
              and p.created_by = auth.uid() and p.status::text in ('open', 'locked', 'proposed')));

drop policy if exists pool_clip_read on storage.objects;
create policy pool_clip_read on storage.objects for select to authenticated using (
  bucket_id = 'pool-clips'
  and exists (select 1 from public.pools p where p.id::text = (storage.foldername(name))[1] and public.is_member(p.group_id)));

create or replace function public.set_pool_clip(p_pool uuid, p_kind text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_to uuid[];
begin
  select * into v_pool from public.pools where id = p_pool;
  if not found or v_pool.created_by is distinct from auth.uid() then raise exception 'only the pool’s creator can add the clip'; end if;
  if v_pool.status::text not in ('open', 'locked', 'proposed') then raise exception 'this pool is already settled'; end if;
  if p_path is null or p_path not like p_pool::text || '/%' or p_path like '%..%' then raise exception 'bad clip file'; end if;
  if p_kind = 'setup' then
    update public.pools set clip_path = p_path where id = p_pool;
    select array_agg(user_id) into v_to from public.group_members where group_id = v_pool.group_id and user_id <> auth.uid();
    perform public.push_to(v_to, '🎬 new crew clip', v_pool.question || ' — watch it and make your call', jsonb_build_object('go', 'pool', 'id', p_pool));
  elsif p_kind = 'reveal' then
    if v_pool.clip_path is null then raise exception 'post the setup clip first'; end if;
    update public.pools set reveal_path = p_path where id = p_pool;
    select array_agg(user_id) into v_to from public.pool_entries where pool_id = p_pool and user_id <> auth.uid();
    perform public.push_to(v_to, '🎬 the reveal is in', v_pool.question || ' — see how it ended', jsonb_build_object('go', 'pool', 'id', p_pool));
  else
    raise exception 'bad clip kind';
  end if;
end $$;
grant execute on function public.set_pool_clip(uuid, text, text) to authenticated;

-- Paths for the crew. The reveal stays hidden until calls are closed (deadline passed or result in).
create or replace function public.pool_clips(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'setup', p.clip_path,
    'reveal', case when p.status::text <> 'open' or p.closes_at <= now() or p.created_by = auth.uid() then p.reveal_path end,
    'has_reveal', p.reveal_path is not null)
  from public.pools p where p.id = p_pool and public.is_member(p.group_id)
$$;
grant execute on function public.pool_clips(uuid) to authenticated;

-- 3. Paid creators: coming soon. Collect interest now.
create table if not exists public.creator_waitlist (
  user_id    uuid primary key references public.profiles on delete cascade,
  handle     text check (handle is null or length(handle) <= 60),
  followers  text check (followers is null or followers in ('<1k', '1k-10k', '10k-100k', '100k+')),
  created_at timestamptz not null default now()
);
alter table public.creator_waitlist enable row level security;
drop policy if exists own_waitlist on public.creator_waitlist;
create policy own_waitlist on public.creator_waitlist for select using (user_id = auth.uid());

create or replace function public.join_creator_waitlist(p_handle text, p_followers text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.creator_waitlist (user_id, handle, followers)
  values (auth.uid(), nullif(left(trim(p_handle), 60), ''), p_followers)
  on conflict (user_id) do update set handle = excluded.handle, followers = excluded.followers;
end $$;
grant execute on function public.join_creator_waitlist(text, text) to authenticated;

-- 4. Funnel events for the new flows.
create or replace function public.track(p_name text, p_props jsonb default '{}'::jsonb, p_platform text default null::text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_seen', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'push_opened', 'first_run_skipped', 'result_shared', 'standings_viewed',
                    'review_prompted', 'warmup_seen', 'warmup_played', 'proof_added', 'live_activity_started',
                    'crew_message', 'feed_viewed', 'template_used', 'rematch',
                    'poll_created', 'poll_voted', 'crew_qr_shown',
                    'night_started', 'night_quick_pool',
                    'clip_setup_added', 'clip_reveal_added', 'clip_called', 'creator_waitlist') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $function$;
