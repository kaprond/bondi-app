-- 0019: smarter push nudges, "who's in" on pool previews, funnel report.

-- 1. Nudge log: every cron/milestone nudge is sent at most once per (user, kind, ref),
--    at most 3 a day per person, and cron nudges only between 09:00 and 21:30 Amsterdam time.
create table if not exists public.nudges (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null,
  ref     text not null default '',
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
create index if not exists nudges_user_time on public.nudges (user_id, sent_at);
alter table public.nudges enable row level security; -- no policies: server only

create or replace function public.quiet_hours() returns boolean
language sql stable as $$
  select (now() at time zone 'Europe/Amsterdam')::time not between time '09:00' and time '21:30'
$$;

create or replace function public.nudge(p_users uuid[], p_kind text, p_ref text, p_title text, p_body text, p_data jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_to uuid[];
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  select array_agg(u) into v_to from unnest(p_users) u
   where u is not null
     and exists (select 1 from public.push_tokens t where t.user_id = u)
     and not exists (select 1 from public.nudges n where n.user_id = u and n.kind = p_kind and n.ref = coalesce(p_ref, ''))
     and (select count(*) from public.nudges n where n.user_id = u and n.sent_at > now() - interval '24 hours') < 3;
  if v_to is null then return 0; end if;
  insert into public.nudges (user_id, kind, ref) select u, p_kind, coalesce(p_ref, '') from unnest(v_to) u on conflict do nothing;
  perform public.push_to(v_to, p_title, p_body, coalesce(p_data, '{}') || jsonb_build_object('nudge', p_kind));
  return cardinality(v_to);
end $$;

-- 2. Milestone: the 3rd person calls it → the rest of the crew gets "3 friends already called it".
create or replace function public.push_on_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_n int; v_to uuid[];
begin
  select * into v_pool from public.pools where id = new.pool_id;
  if v_pool.created_by is not null and v_pool.created_by <> new.user_id then
    perform public.push_to(array[v_pool.created_by], 'someone joined your pool', public.handle_of(new.user_id) || ' is in on: ' || v_pool.question, jsonb_build_object('go', 'pool', 'id', v_pool.id));
  end if;
  select count(*) into v_n from public.pool_entries where pool_id = new.pool_id;
  if v_n = 3 and v_pool.status::text = 'open' then
    select array_agg(m.user_id) into v_to from public.group_members m
     where m.group_id = v_pool.group_id and m.user_id is distinct from v_pool.subject_user_id
       and not exists (select 1 from public.pool_entries e where e.pool_id = v_pool.id and e.user_id = m.user_id);
    perform public.nudge(v_to, 'crowd', v_pool.id::text, '3 friends already called it 👀', v_pool.question || ' — you in?', jsonb_build_object('go', 'pool', 'id', v_pool.id));
  end if;
  return null;
end $$;

-- 3. Cron nudges, every 15 minutes (outside quiet hours).
create or replace function public.smart_nudges() returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_to uuid[]; v_local timestamp := now() at time zone 'Europe/Amsterdam';
begin
  if public.quiet_hours() then return; end if;

  -- a) your vote decides it: result proposed 12h+ ago, you played, you haven't voted
  for r in select * from public.pools where status = 'proposed' and proposed_at < now() - interval '12 hours' loop
    select array_agg(e.user_id) into v_to from public.pool_entries e
     where e.pool_id = r.id and e.user_id is distinct from r.created_by
       and not exists (select 1 from public.pool_votes v where v.pool_id = r.id and v.user_id = e.user_id);
    perform public.nudge(v_to, 'vote', r.id::text, 'your vote decides it 🗳️', 'was the result right? ' || r.question, jsonb_build_object('go', 'pool', 'id', r.id));
  end loop;

  -- b) streak at risk: from 19:00, you claimed yesterday (streak 2+) but not today
  if extract(hour from v_local) >= 19 then
    for r in select p.id, p.daily_streak from public.profiles p
             where p.last_daily_grant = current_date - 1 and p.daily_streak >= 2 loop
      perform public.nudge(array[r.id], 'streak', current_date::text, 'your ' || r.daily_streak || '-day streak ends at midnight 🔥', 'open LetsJam to grab today’s coins', jsonb_build_object('go', 'pools'));
    end loop;
  end if;

  -- c) comeback: no app open for 3 days, and an open pool in your crew is waiting on you (max once per 3 days)
  for r in
    select m.user_id, count(distinct p.id) as n, (array_agg(g.name order by p.created_at desc))[1] as crew
    from public.group_members m
    join public.pools p on p.group_id = m.group_id and p.status = 'open' and (p.closes_at is null or p.closes_at > now())
    join public.groups g on g.id = m.group_id
    where m.user_id is distinct from p.subject_user_id
      and not exists (select 1 from public.pool_entries e where e.pool_id = p.id and e.user_id = m.user_id)
      and not exists (select 1 from public.events ev where ev.user_id = m.user_id and ev.name = 'app_open' and ev.created_at > now() - interval '3 days')
    group by m.user_id
  loop
    perform public.nudge(array[r.user_id], 'comeback', to_char(now(), 'YYYY-MM-DD')::text || '-' || (extract(doy from now())::int / 3)::text,
      case when r.n = 1 then '1 open pool in ' || r.crew else r.n || ' open pools in ' || r.crew end || ' 👀',
      'your crew is waiting on your call', jsonb_build_object('go', 'pools'));
  end loop;

  -- d) Sunday 19:00 weekly recap per crew: who called the most this week
  if extract(dow from v_local) = 0 and extract(hour from v_local) = 19 then
    for r in
      with wk as (
        select p.group_id, e.user_id, count(*) filter (where e.option_id = p.resolved_option) as won, count(*) as played
        from public.pools p join public.pool_entries e on e.pool_id = p.id
        where p.status = 'resolved' and coalesce(p.proposed_at, p.created_at) > now() - interval '7 days'
        group by 1, 2
      ), top as (
        select distinct on (group_id) group_id, user_id, won, played from wk order by group_id, won desc, played asc
      )
      select t.*, g.name from top t join public.groups g on g.id = t.group_id where t.won > 0
    loop
      select array_agg(m.user_id) into v_to from public.group_members m where m.group_id = r.group_id;
      perform public.nudge(v_to, 'weekly', r.group_id::text || '-' || to_char(now(), 'IYYY-IW'),
        r.name || ': week in review 🏆', public.handle_of(r.user_id) || ' called ' || r.won || ' of ' || r.played || '. new week, new pools. beat that',
        jsonb_build_object('go', 'pools'));
    end loop;
  end if;
end $$;
revoke execute on function public.smart_nudges(), public.nudge(uuid[], text, text, text, text, jsonb), public.quiet_hours() from public, anon, authenticated;
select cron.schedule('smart-nudges', '*/15 * * * *', 'select public.smart_nudges()');

-- 4. Pool link previews show who's in: options with counts, players, crew size, deadline.
create or replace function public.pool_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question, 'crew', g.name, 'forfeit', p.forfeit,
    'pot', (select count(*) from public.pool_entries e where e.pool_id = p.id) * p.stake,
    'stake', p.stake,
    'by', (select handle from public.profiles where id = p.created_by),
    'status', p.status,
    'players', (select count(*) from public.pool_entries e where e.pool_id = p.id),
    'crew_size', (select count(*) from public.group_members m where m.group_id = p.group_id),
    'closes_at', p.closes_at,
    'options', (select coalesce(jsonb_agg(jsonb_build_object('label', o.label,
                  'n', (select count(*) from public.pool_entries e where e.pool_id = p.id and e.option_id = o.id))), '[]')
                from public.pool_options o where o.pool_id = p.id))
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status in ('pending_consent', 'open', 'proposed')
$$;
grant execute on function public.pool_preview(uuid) to anon, authenticated;

-- 5. More funnel events.
create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_seen', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'push_opened', 'first_run_skipped', 'result_shared', 'standings_viewed',
                    'review_prompted') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;

-- 6. Funnel report for /admin (counts only, no personal data). Guarded by a random key stored server-side.
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security; -- no policies: server only
insert into public.app_secrets (name, value) values ('funnel', encode(extensions.gen_random_bytes(12), 'hex')) on conflict (name) do nothing;

create or replace function public.funnel_report(p_key text, p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 365));
begin
  if p_key is null or p_key <> (select value from public.app_secrets where name = 'funnel') then
    raise exception 'not allowed';
  end if;
  return (
    with c as (select id, created_at from public.profiles where created_at >= v_since),
    ev as (select e.user_id, e.name, e.platform, e.created_at from public.events e join c on c.id = e.user_id),
    steps as (
      select
        count(*) as visited,
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name = 'welcome_seen')) as saw_welcome,
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name = 'welcome_done')) as said_yes,
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name = 'profile_done')) as made_profile,
        count(*) filter (where exists (select 1 from public.group_members m where m.user_id = c.id)) as in_crew,
        count(*) filter (where exists (select 1 from public.pool_entries e where e.user_id = c.id)
                            or exists (select 1 from public.pools p where p.created_by = c.id)) as played,
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name in ('invite_shared', 'pool_shared', 'result_shared'))) as shared,
        count(*) filter (where exists (select 1 from public.push_tokens t where t.user_id = c.id)) as push_on,
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name = 'app_open' and ev.created_at::date > c.created_at::date)) as came_back
      from c
    ),
    days as (
      select d::date as day,
        (select count(*) from c where c.created_at::date = d::date) as visited,
        (select count(distinct user_id) from ev where ev.name = 'welcome_done' and ev.created_at::date = d::date) as said_yes,
        (select count(distinct e.user_id) from public.pool_entries e where e.created_at::date = d::date) as played
      from generate_series(v_since::date, now()::date, interval '1 day') d
    )
    select jsonb_build_object(
      'since', v_since, 'steps', (select to_jsonb(steps) from steps),
      'days', (select coalesce(jsonb_agg(to_jsonb(days) order by day), '[]') from days),
      'totals', jsonb_build_object(
        'crews', (select count(*) from public.groups), 'pools', (select count(*) from public.pools),
        'open_pools', (select count(*) from public.pools where status = 'open'),
        'push_users', (select count(distinct user_id) from public.push_tokens)),
      'platforms', (select coalesce(jsonb_object_agg(platform, n), '{}') from (
         select coalesce(platform, '?') platform, count(distinct user_id) n from ev where name = 'welcome_seen' group by 1) x),
      'nudges', (select coalesce(jsonb_object_agg(kind, n), '{}') from (
         select kind, count(*) n from public.nudges where sent_at >= now() - interval '7 days' group by 1) x),
      'push_opened', (select coalesce(jsonb_object_agg(k, n), '{}') from (
         select coalesce(props->>'nudge', props->>'go', 'other') k, count(*) n from public.events
         where name = 'push_opened' and created_at >= now() - interval '7 days' group by 1) x))
  );
end $$;
revoke execute on function public.funnel_report(text, int) from public, authenticated;
grant execute on function public.funnel_report(text, int) to anon;
