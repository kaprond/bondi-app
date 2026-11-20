-- 0020: photo proof to settle, weekly crew titles, warm-up round in the funnel.

-- 1. Photo proof. Private bucket: only the pool's crew can see it, only the creator can add it.
alter table public.pools add column if not exists proof_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pool-proofs', 'pool-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists proof_upload on storage.objects;
create policy proof_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'pool-proofs'
  and exists (select 1 from public.pools p where p.id::text = (storage.foldername(name))[1]
              and p.created_by = auth.uid() and p.status in ('open', 'locked', 'proposed')));

drop policy if exists proof_read on storage.objects;
create policy proof_read on storage.objects for select to authenticated using (
  bucket_id = 'pool-proofs'
  and exists (select 1 from public.pools p where p.id::text = (storage.foldername(name))[1] and public.is_member(p.group_id)));

create or replace function public.set_proof(p_pool uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_to uuid[];
begin
  select * into v_pool from public.pools where id = p_pool;
  if not found or v_pool.created_by is distinct from auth.uid() then raise exception 'only the pool’s creator can add proof'; end if;
  if v_pool.status::text not in ('open', 'locked', 'proposed') then raise exception 'this pool is already settled'; end if;
  if p_path is null or p_path not like p_pool::text || '/%' or p_path like '%..%' then raise exception 'bad proof file'; end if;
  update public.pools set proof_path = p_path where id = p_pool;
  if v_pool.status::text = 'proposed' then
    select array_agg(user_id) into v_to from public.pool_entries where pool_id = p_pool and user_id <> auth.uid();
    perform public.push_to(v_to, '📸 proof is in', v_pool.question || ' — check it and vote', jsonb_build_object('go', 'pool', 'id', p_pool));
  end if;
end $$;
grant execute on function public.set_proof(uuid, text) to authenticated;

create or replace function public.pool_proof(p_pool uuid) returns text
language sql stable security definer set search_path = public as $$
  select p.proof_path from public.pools p where p.id = p_pool and public.is_member(p.group_id)
$$;
grant execute on function public.pool_proof(uuid) to authenticated;

-- result card: shows that proof exists (never the photo itself: shared links are public)
create or replace function public.result_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question, 'crew', g.name, 'emoji', g.emoji, 'round', p.round, 'forfeit', p.forfeit,
    'proof', p.proof_path is not null,
    'winner', (select label from public.pool_options where id = p.resolved_option),
    'pot', (select coalesce(sum(stake), 0) from public.pool_entries where pool_id = p.id),
    'players', (select count(*) from public.pool_entries where pool_id = p.id),
    'called_it', coalesce((select jsonb_agg(pr.handle order by e.created_at) from public.pool_entries e join public.profiles pr on pr.id = e.user_id
                            where e.pool_id = p.id and e.option_id = p.resolved_option and pr.handle is not null), '[]'))
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status = 'resolved'
$$;
grant execute on function public.result_preview(uuid) to anon, authenticated;

-- 2. Weekly crew titles, rolling 7 days of settled pools.
create or replace function public.titles_for(p_group uuid) returns table (key text, emoji text, title text, user_id uuid, why text)
language sql stable security definer set search_path = public as $$
  with base as (
    select e.user_id, (e.option_id = p.resolved_option) as won,
      (select count(*) from public.pool_entries x where x.pool_id = p.id and x.option_id = e.option_id) as side_n,
      (select count(*) from public.pool_entries x where x.pool_id = p.id) as total_n
    from public.pools p join public.pool_entries e on e.pool_id = p.id
    where p.group_id = p_group and p.status = 'resolved' and coalesce(p.proposed_at, p.created_at) > now() - interval '7 days'
  ), per as (
    select b.user_id, count(*) filter (where won) as w, count(*) filter (where not won) as l, count(*) as n,
      count(*) filter (where won and side_n * 2 < total_n) as underdog
    from base b group by 1
  ), started as (
    select created_by as user_id, count(*) as n from public.pools
    where group_id = p_group and created_at > now() - interval '7 days' and created_by is not null group by 1
  )
  (select 'oracle', '🔮', 'the oracle', per.user_id, per.w || ' right calls' from per where w >= 2 order by w desc, l asc limit 1)
  union all
  (select 'underdog', '🐺', 'the underdog', per.user_id, per.underdog || case when per.underdog = 1 then ' win' else ' wins' end || ' against the crowd' from per where underdog >= 1 order by underdog desc, w desc limit 1)
  union all
  (select 'wrong', '🤡', 'wrong again', per.user_id, per.l || ' wrong calls' from per where l >= 2 order by l desc, w asc limit 1)
  union all
  (select 'leader', '📣', 'ring leader', started.user_id, started.n || ' pools started' from started where n >= 2 order by n desc limit 1)
  union all
  (select 'allin', '🎲', 'all in', per.user_id, per.n || ' pools played' from per where n >= 3 order by n desc limit 1)
$$;
revoke execute on function public.titles_for(uuid) from public, anon, authenticated;

create or replace function public.crew_titles(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'emoji', t.emoji, 'title', t.title, 'user', t.user_id,
           'handle', (select handle from public.profiles where id = t.user_id), 'why', t.why)), '[]')
  from public.titles_for(p_group) t
  where public.is_member(p_group)
$$;
grant execute on function public.crew_titles(uuid) to authenticated;

create or replace function public.my_titles() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'emoji', t.emoji, 'title', t.title, 'why', t.why, 'crew', g.name)), '[]')
  from public.group_members m join public.groups g on g.id = m.group_id
  cross join lateral public.titles_for(m.group_id) t
  where m.user_id = auth.uid() and t.user_id = auth.uid()
$$;
grant execute on function public.my_titles() to authenticated;

-- 3. Sunday recap now crowns the oracle (rest of smart_nudges unchanged from 0019).
create or replace function public.smart_nudges() returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_to uuid[]; v_local timestamp := now() at time zone 'Europe/Amsterdam';
begin
  if public.quiet_hours() then return; end if;

  for r in select * from public.pools where status = 'proposed' and proposed_at < now() - interval '12 hours' loop
    select array_agg(e.user_id) into v_to from public.pool_entries e
     where e.pool_id = r.id and e.user_id is distinct from r.created_by
       and not exists (select 1 from public.pool_votes v where v.pool_id = r.id and v.user_id = e.user_id);
    perform public.nudge(v_to, 'vote', r.id::text, 'your vote decides it 🗳️', 'was the result right? ' || r.question, jsonb_build_object('go', 'pool', 'id', r.id));
  end loop;

  if extract(hour from v_local) >= 19 then
    for r in select p.id, p.daily_streak from public.profiles p
             where p.last_daily_grant = current_date - 1 and p.daily_streak >= 2 loop
      perform public.nudge(array[r.id], 'streak', current_date::text, 'your ' || r.daily_streak || '-day streak ends at midnight 🔥', 'open LetsJam to grab today’s coins', jsonb_build_object('go', 'pools'));
    end loop;
  end if;

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

  if extract(dow from v_local) = 0 and extract(hour from v_local) = 19 then
    for r in
      select g.id as group_id, g.name, t.user_id, t.why
      from public.groups g cross join lateral public.titles_for(g.id) t
      where t.key = 'oracle'
    loop
      select array_agg(m.user_id) into v_to from public.group_members m where m.group_id = r.group_id;
      perform public.nudge(v_to, 'weekly', r.group_id::text || '-' || to_char(now(), 'IYYY-IW'),
        r.name || ': week in review 🏆', '🔮 ' || public.handle_of(r.user_id) || ' is this week’s oracle (' || r.why || '). new week, new pools. take the crown',
        jsonb_build_object('go', 'pools'));
    end loop;
  end if;
end $$;
revoke execute on function public.smart_nudges() from public, anon, authenticated;

-- 4. New events.
create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_seen', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'push_opened', 'first_run_skipped', 'result_shared', 'standings_viewed',
                    'review_prompted', 'warmup_seen', 'warmup_played', 'proof_added', 'live_activity_started') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;

-- 5. Funnel: warm-up round step.
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
        count(*) filter (where exists (select 1 from ev where ev.user_id = c.id and ev.name = 'warmup_played')) as warmed_up,
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
