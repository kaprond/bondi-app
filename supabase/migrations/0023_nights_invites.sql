-- 0023: match night mode, faster settling, invite rewards.

-- 1. Pools settle as soon as most players agree (no more waiting 48h when everyone confirms).
create or replace function public.finalize_pool(p_pool uuid) returns pool_status
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_n int; v_yes int; v_no int; v_pot bigint; v_winners int;
begin
  select * into v_pool from public.pools where id = p_pool for update;
  if v_pool.status <> 'proposed' then return v_pool.status; end if;

  select count(*), coalesce(sum(stake),0) into v_n, v_pot from public.pool_entries where pool_id = p_pool;
  select count(*) filter (where confirm), count(*) filter (where not confirm) into v_yes, v_no from public.pool_votes where pool_id = p_pool;
  -- before 48h only a clear majority (either way) settles it early
  if now() < v_pool.proposed_at + interval '48 hours' and not (v_yes * 2 > v_n or v_no * 2 > v_n) then
    return v_pool.status; end if;
  select count(*) into v_winners from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option;

  if v_yes * 2 > v_n and v_winners > 0 then
    insert into public.ledger (user_id, amount, reason)
      select user_id, v_pot / v_winners + case when rn <= v_pot % v_winners then 1 else 0 end, 'pool_payout'
      from (select user_id, row_number() over (order by created_at, user_id) rn
            from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option) w;
    update public.pools set status = 'resolved', resolved_option = v_pool.proposed_option where id = p_pool;
    return 'resolved';
  else
    insert into public.ledger (user_id, amount, reason)
      select user_id, stake, 'pool_refund' from public.pool_entries where pool_id = p_pool;
    update public.pools set status = 'voided' where id = p_pool;
    return 'voided';
  end if;
end $$;

create or replace function public.vote_result(p_pool uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.pool_entries where pool_id = p_pool and user_id = auth.uid()) then
    raise exception 'only participants vote'; end if;
  insert into public.pool_votes (pool_id, user_id, confirm) values (p_pool, auth.uid(), p_confirm)
    on conflict (pool_id, user_id) do update set confirm = excluded.confirm, voted_at = now();
  perform public.finalize_pool(p_pool); -- settles right away once most players agree
end $$;

-- quick pools for match night: deadlines from 4 minutes (was 15)
do $f$
declare v_src text;
begin
  select pg_get_functiondef('public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text, text)'::regprocedure) into v_src;
  if position($q$interval '15 minutes'$q$ in v_src) > 0 then
    execute replace(v_src, $q$interval '15 minutes'$q$, $q$interval '4 minutes'$q$);
  end if;
end $f$;

-- 2. Match night: a crew session (e.g. "Ajax – PSV") with quick pools and a live scoreboard.
create table if not exists public.match_nights (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups on delete cascade,
  title      text not null check (char_length(title) between 2 and 60),
  started_by uuid references public.profiles on delete set null,
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null
);
create index if not exists match_nights_group on public.match_nights (group_id, ends_at desc);
alter table public.match_nights enable row level security;
drop policy if exists member_nights on public.match_nights;
create policy member_nights on public.match_nights for select using (public.is_member(group_id));
do $$ begin alter publication supabase_realtime add table public.match_nights; exception when duplicate_object then null; end $$;

create or replace function public.start_match_night(p_group uuid, p_title text, p_hours int default 3) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_topic text; v_to uuid[]; v_name text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_group) then raise exception 'crew not found'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'what are you watching?'; end if;
  v_topic := public.blocked_topic(p_title);
  if v_topic is not null then raise exception 'keep it fun: no %.', v_topic; end if;
  if exists (select 1 from public.match_nights where group_id = p_group and ends_at > now()) then raise exception 'there’s already a match night on.'; end if;
  insert into public.match_nights (group_id, title, started_by, ends_at)
  values (p_group, left(trim(p_title), 60), v_me, now() + make_interval(hours => least(greatest(coalesce(p_hours, 3), 1), 6)))
  returning id into v_id;
  select name into v_name from public.groups where id = p_group;
  select array_agg(m.user_id) into v_to from public.group_members m
   where m.group_id = p_group and m.user_id <> v_me and not public.is_blocked_between(m.user_id, v_me);
  perform public.push_to(v_to, '⚽ match night in ' || v_name, left(trim(p_title), 60) || ': quick pools all night. jump in', jsonb_build_object('go', 'crew', 'id', p_group));
  return v_id;
end $$;
grant execute on function public.start_match_night(uuid, text, int) to authenticated;

create or replace function public.end_match_night(p_group uuid) returns void
language sql security definer set search_path = public as $$
  update public.match_nights set ends_at = now()
  where group_id = p_group and ends_at > now() and (started_by = auth.uid() or public.is_member(p_group))
$$;
grant execute on function public.end_match_night(uuid) to authenticated;

-- the current night (or null) with its scoreboard: net coins from pools made during the night
create or replace function public.crew_night(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (
    select * from public.match_nights where group_id = p_group and ends_at > now() order by started_at desc limit 1
  ), settled as (
    select p.id, p.resolved_option,
           (select sum(stake) from public.pool_entries where pool_id = p.id)::bigint as pot,
           (select count(*) from public.pool_entries where pool_id = p.id and option_id = p.resolved_option) as winners
    from public.pools p, n
    where p.group_id = p_group and p.status = 'resolved' and p.created_at >= n.started_at
  ), entries as (
    select e.*, s.pot, s.winners, (e.option_id = s.resolved_option) as won,
           row_number() over (partition by e.pool_id, (e.option_id = s.resolved_option) order by e.created_at, e.user_id) as rn
    from settled s join public.pool_entries e on e.pool_id = s.id
  ), board as (
    select user_id, count(*) as played, count(*) filter (where won) as won,
           sum(case when won then pot / winners + case when rn <= pot % winners then 1 else 0 end - stake else -stake end) as net
    from entries group by user_id
  )
  select case when not public.is_member(p_group) or not exists (select 1 from n) then null else (
    select jsonb_build_object('id', n.id, 'title', n.title, 'started_by', n.started_by, 'started_at', n.started_at, 'ends_at', n.ends_at,
      'pools', (select count(*) from public.pools p where p.group_id = p_group and p.created_at >= n.started_at),
      'board', coalesce((select jsonb_agg(jsonb_build_object('user', user_id, 'played', played, 'won', won, 'net', net) order by net desc, won desc) from board), '[]'))
    from n)
  end
$$;
grant execute on function public.crew_night(uuid) to authenticated;

-- 3. Invite rewards: when someone you invited plays their first pool, you get +20 (max 20 friends).
alter table public.invite_redemptions add column if not exists played_at timestamptz;

create or replace function public.reward_inviter_on_first_play() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_code text;
begin
  select r.code, c.owner into v_code, v_owner
  from public.invite_redemptions r join public.invite_codes c on c.code = r.code
  where r.new_user = new.user_id and r.played_at is null;
  if v_owner is null then return null; end if;
  update public.invite_redemptions set played_at = now() where new_user = new.user_id and played_at is null;
  if (select count(*) from public.invite_redemptions where code = v_code and played_at is not null) <= 20 then
    insert into public.ledger (user_id, amount, reason) values (v_owner, 20, 'referral_bonus');
    perform public.push_to(array[v_owner], '🎉 +20 coins', public.handle_of(new.user_id) || ' played their first pool. thanks for bringing them in', jsonb_build_object('go', 'pools'));
  end if;
  return null;
end $$;
drop trigger if exists reward_inviter on public.pool_entries;
create trigger reward_inviter after insert on public.pool_entries for each row execute function public.reward_inviter_on_first_play();

-- your invite stats + the top inviters among you and your friends (this month)
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select r.* from public.invite_redemptions r join public.invite_codes c on c.code = r.code where c.owner = auth.uid()
  ), circle as (
    select auth.uid() as id
    union select case when f.requester = auth.uid() then f.addressee else f.requester end
    from public.friendships f where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee)
  ), board as (
    select c.owner as user_id, count(*) as joined, count(r.played_at) as played
    from public.invite_redemptions r join public.invite_codes c on c.code = r.code
    where c.owner in (select id from circle) and r.redeemed_at >= date_trunc('month', now())
    group by c.owner
  )
  select jsonb_build_object(
    'joined', (select count(*) from mine),
    'played', (select count(*) from mine where played_at is not null),
    'earned', (select count(*) from mine) * 10 + least((select count(*) from mine where played_at is not null), 20) * 20,
    'founder', exists (select 1 from public.groups g where g.created_by = auth.uid() and (select count(*) from public.group_members m where m.group_id = g.id) >= 5),
    'board', coalesce((select jsonb_agg(jsonb_build_object('user', user_id, 'joined', joined, 'played', played) order by played desc, joined desc) from (select * from board order by played desc, joined desc limit 10) b), '[]'))
$$;
grant execute on function public.my_invites() to authenticated;

-- 4. New events.
create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_seen', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'push_opened', 'first_run_skipped', 'result_shared', 'standings_viewed',
                    'review_prompted', 'warmup_seen', 'warmup_played', 'proof_added', 'live_activity_started',
                    'crew_message', 'feed_viewed', 'template_used', 'rematch',
                    'poll_created', 'poll_voted', 'crew_qr_shown',
                    'night_started', 'night_quick_pool') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;
