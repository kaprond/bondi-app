-- 0021: crew feed (chat + timeline) and head-to-head rivalries.

-- 1. Crew chat messages.
create table if not exists public.crew_messages (
  id         bigint generated always as identity primary key,
  group_id   uuid not null references public.groups on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists crew_messages_group on public.crew_messages (group_id, created_at desc);
alter table public.crew_messages enable row level security;
drop policy if exists member_messages on public.crew_messages;
create policy member_messages on public.crew_messages for select using (
  public.is_member(group_id)
  and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = user_id));

do $$ begin
  alter publication supabase_realtime add table public.crew_messages;
exception when duplicate_object then null; end $$;

-- chat pushes don't count toward the 3-a-day nudge cap
create or replace function public.nudge(p_users uuid[], p_kind text, p_ref text, p_title text, p_body text, p_data jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_to uuid[];
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  select array_agg(u) into v_to from unnest(p_users) u
   where u is not null
     and exists (select 1 from public.push_tokens t where t.user_id = u)
     and not exists (select 1 from public.nudges n where n.user_id = u and n.kind = p_kind and n.ref = coalesce(p_ref, ''))
     and (p_kind = 'chat' or (select count(*) from public.nudges n where n.user_id = u and n.kind <> 'chat' and n.sent_at > now() - interval '24 hours') < 3);
  if v_to is null then return 0; end if;
  insert into public.nudges (user_id, kind, ref) select u, p_kind, coalesce(p_ref, '') from unnest(v_to) u on conflict do nothing;
  perform public.push_to(v_to, p_title, p_body, coalesce(p_data, '{}') || jsonb_build_object('nudge', p_kind));
  return cardinality(v_to);
end $$;
revoke execute on function public.nudge(uuid[], text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.post_crew_message(p_group uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_topic text; v_id bigint; v_to uuid[]; v_name text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_group) then raise exception 'crew not found'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'say something first.'; end if;
  v_topic := public.blocked_topic(p_body);
  if v_topic is not null then raise exception 'keep it fun: no %.', v_topic; end if;
  if (select count(*) from public.crew_messages where user_id = v_me and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'slow down a bit.'; end if;
  insert into public.crew_messages (group_id, user_id, body) values (p_group, v_me, left(trim(p_body), 280)) returning id into v_id;
  select name into v_name from public.groups where id = p_group;
  -- push the crew, at most once per 10 minutes per person per crew, never to people who blocked you
  select array_agg(m.user_id) into v_to from public.group_members m
   where m.group_id = p_group and m.user_id <> v_me and not public.is_blocked_between(m.user_id, v_me);
  perform public.nudge(v_to, 'chat', p_group::text || '-' || (extract(epoch from now())::bigint / 600)::text,
    v_name || ' 💬', public.handle_of(v_me) || ': ' || left(trim(p_body), 100), jsonb_build_object('go', 'crew', 'id', p_group));
  return v_id;
end $$;
grant execute on function public.post_crew_message(uuid, text) to authenticated;

create or replace function public.delete_crew_message(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from public.crew_messages where id = p_id and user_id = auth.uid()
$$;
grant execute on function public.delete_crew_message(bigint) to authenticated;

-- 2. The crew timeline: messages, new pools, results, trash talk, joins. Newest last, up to 80.
create or replace function public.crew_feed(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with items as (
    select 'message' as kind, m.created_at as at, m.user_id as "user", m.body, null::uuid as pool, null::text as question, null::text as extra, m.id::text as id
      from public.crew_messages m
     where m.group_id = p_group and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = m.user_id)
    union all
    select 'pool', p.created_at, p.created_by, null, p.id, p.question, p.forfeit, 'p' || p.id
      from public.pools p where p.group_id = p_group and p.status not in ('rejected')
    union all
    select 'result', coalesce(p.proposed_at, p.created_at) + interval '48 hours', null, null, p.id, p.question,
           (select label from public.pool_options where id = p.resolved_option)
           || ' · ' || (select count(*) from public.pool_entries e where e.pool_id = p.id and e.option_id = p.resolved_option)::text
           || ' of ' || (select count(*) from public.pool_entries e where e.pool_id = p.id)::text || ' called it',
           'r' || p.id
      from public.pools p where p.group_id = p_group and p.status = 'resolved'
    union all
    select 'comment', c.created_at, c.user_id, c.body, c.pool_id, p.question, null, 'c' || c.id
      from public.pool_comments c join public.pools p on p.id = c.pool_id
     where p.group_id = p_group and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = c.user_id)
    union all
    select 'joined', gm.joined_at, gm.user_id, null, null, null, null, 'j' || gm.user_id
      from public.group_members gm where gm.group_id = p_group
  ), recent as (
    select * from items where at <= now() order by at desc limit 80
  )
  select case when not public.is_member(p_group) then null else
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'at', at, 'user', "user", 'body', body, 'pool', pool, 'question', question, 'extra', extra) order by at) from recent), '[]')
  end
$$;
grant execute on function public.crew_feed(uuid) to authenticated;

-- 3. Head-to-head: pools where you and a friend picked different sides. You win it if you were right.
create or replace function public.my_rivals() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select e.pool_id, e.option_id, p.resolved_option, coalesce(p.proposed_at, p.created_at) as at
    from public.pool_entries e join public.pools p on p.id = e.pool_id
    where e.user_id = auth.uid() and p.status = 'resolved'
  ), duels as (
    select o.user_id as friend, (m.option_id = m.resolved_option) as i_won, (o.option_id = m.resolved_option) as they_won, m.at
    from mine m join public.pool_entries o on o.pool_id = m.pool_id and o.user_id <> auth.uid() and o.option_id <> m.option_id
    where not public.is_blocked_between(o.user_id, auth.uid())
  )
  select coalesce(jsonb_agg(jsonb_build_object('user', friend, 'me', me, 'them', them, 'last', last) order by me + them desc, last desc), '[]')
  from (
    select friend, count(*) filter (where i_won) as me, count(*) filter (where they_won) as them, max(at) as last
    from duels group by friend having count(*) filter (where i_won or they_won) > 0
  ) x
$$;
grant execute on function public.my_rivals() to authenticated;

-- 4. New events.
create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_seen', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'push_opened', 'first_run_skipped', 'result_shared', 'standings_viewed',
                    'review_prompted', 'warmup_seen', 'warmup_played', 'proof_added', 'live_activity_started',
                    'crew_message', 'feed_viewed', 'template_used', 'rematch') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;
