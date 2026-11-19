-- Result cards, crew standings, repeating pools, JAM- invite codes.

-- 1. Repeating pools ------------------------------------------------------------------------------
alter table public.pools add column if not exists repeat text check (repeat in ('weekly')),
                         add column if not exists repeat_spawned boolean not null default false,
                         add column if not exists round int not null default 1;

drop function if exists public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz);
create or replace function public.create_pool(p_group uuid, p_question text, p_stake bigint, p_options jsonb,
                                              p_subject uuid default null, p_closes_at timestamptz default null,
                                              p_repeat text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_topic text; o jsonb; v_n int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_group) then raise exception 'you’re not in that crew'; end if;
  if length(trim(coalesce(p_question, ''))) < 5 then raise exception 'ask a question.'; end if;
  v_n := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  if v_n < 2 or v_n > 6 then raise exception 'add 2 to 6 outcomes.'; end if;
  if p_closes_at is not null and (p_closes_at < now() + interval '15 minutes' or p_closes_at > now() + interval '30 days') then
    raise exception 'pick a deadline between 15 minutes and 30 days from now.'; end if;
  if p_repeat is not null and p_repeat <> 'weekly' then raise exception 'pools can only repeat weekly.'; end if;
  if p_repeat is not null and p_closes_at is null then raise exception 'a weekly pool needs a deadline.'; end if;
  if p_repeat is not null and p_subject is not null then raise exception 'pools about one friend can’t repeat.'; end if;
  v_topic := public.blocked_topic(p_question || ' ' || (select string_agg(x->>'label', ' ') from jsonb_array_elements(p_options) x));
  if v_topic is not null then raise exception 'pools about % aren’t allowed. keep it fun for everyone.', v_topic; end if;
  if p_subject is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = p_subject) then
    raise exception 'the person it’s about has to be in the crew.'; end if;
  if p_subject = v_me then raise exception 'you can’t make a pool about yourself.'; end if;

  insert into public.pools (group_id, created_by, question, stake, subject_user_id, status, closes_at, repeat)
    values (p_group, v_me, trim(p_question), p_stake, p_subject,
            case when p_subject is null then 'open' else 'pending_consent' end::pool_status, p_closes_at, p_repeat)
    returning id into v_id;
  for o in select * from jsonb_array_elements(p_options) loop
    if length(trim(coalesce(o->>'label', ''))) = 0 then raise exception 'outcomes can’t be empty.'; end if;
    if (o->>'member') is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = (o->>'member')::uuid) then
      raise exception 'everyone named in an outcome has to be in the crew.'; end if;
    insert into public.pool_options (pool_id, label, member_user_id) values (v_id, trim(o->>'label'), (o->>'member')::uuid);
  end loop;
  return v_id;
end $$;

-- Stop a weekly pool from coming back (creator only; affects future rounds).
create or replace function public.stop_repeat(p_pool uuid) returns void
language sql security definer set search_path = public as $$
  update public.pools set repeat = null where id = p_pool and created_by = auth.uid()
$$;

-- Once a weekly pool's deadline passes, open next week's round with the same question, options and stake.
-- Skipped if the creator left the crew. Runs from the existing 15-minute pool-reminders job.
create or replace function public.spawn_rounds() returns void
language plpgsql security definer set search_path = public as $$
declare p record; v_id uuid; v_close timestamptz;
begin
  for p in select * from public.pools where repeat = 'weekly' and not repeat_spawned and closes_at < now() loop
    update public.pools set repeat_spawned = true where id = p.id;
    if not exists (select 1 from public.group_members where group_id = p.group_id and user_id = p.created_by) then continue; end if;
    v_close := p.closes_at + interval '7 days';
    while v_close < now() + interval '1 hour' loop v_close := v_close + interval '7 days'; end loop;
    insert into public.pools (group_id, created_by, question, stake, status, closes_at, repeat, round)
      values (p.group_id, p.created_by, p.question, p.stake, 'open', v_close, 'weekly', p.round + 1) returning id into v_id;
    insert into public.pool_options (pool_id, label, member_user_id)
      select v_id, label, member_user_id from public.pool_options where pool_id = p.id
      and (member_user_id is null or exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = member_user_id));
    if (select count(*) from public.pool_options where pool_id = v_id) < 2 then
      delete from public.pools where id = v_id; continue; end if;
    perform public.push_to(array(select user_id from public.group_members where group_id = p.group_id),
      'round ' || (p.round + 1) || ' is open 🔁', p.question, jsonb_build_object('go', 'pool', 'id', v_id));
  end loop;
end $$;
revoke execute on function public.spawn_rounds() from public, anon, authenticated;

create or replace function public.pool_reminders_and_rounds() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pool_reminders();
  perform public.spawn_rounds();
end $$;
revoke execute on function public.pool_reminders_and_rounds() from public, anon, authenticated;
select cron.schedule('pool-reminders', '*/15 * * * *', 'select public.pool_reminders_and_rounds()');

-- my_pools: + repeat / round
create or replace function public.my_pools() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'group_id', p.group_id, 'group_name', g.name, 'question', p.question, 'stake', p.stake,
    'created_by', p.created_by, 'subject', p.subject_user_id, 'status', p.status, 'closes_at', p.closes_at,
    'proposed', p.proposed_option, 'proposed_at', p.proposed_at, 'resolved', p.resolved_option,
    'repeat', p.repeat, 'round', p.round,
    'comments', (select count(*) from public.pool_comments c where c.pool_id = p.id),
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'member', o.member_user_id) order by o.label), '[]') from public.pool_options o where o.pool_id = p.id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('user', e.user_id, 'option', e.option_id)), '[]') from public.pool_entries e where e.pool_id = p.id),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('user', v.user_id, 'confirm', v.confirm)), '[]') from public.pool_votes v where v.pool_id = p.id)
  ) order by p.created_at desc), '[]')
  from public.pools p join public.groups g on g.id = p.group_id
  where public.is_member(p.group_id) and p.created_at > now() - interval '60 days'
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = p.created_by)
$$;

-- 2. Result cards ---------------------------------------------------------------------------------
-- Public, for the share card at /r/<pool>: settled pools only, handles only (no ids, no picks of losers).
create or replace function public.result_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question, 'crew', g.name, 'emoji', g.emoji, 'round', p.round,
    'winner', (select label from public.pool_options where id = p.resolved_option),
    'pot', (select coalesce(sum(stake), 0) from public.pool_entries where pool_id = p.id),
    'players', (select count(*) from public.pool_entries where pool_id = p.id),
    'called_it', coalesce((select jsonb_agg(pr.handle order by e.created_at) from public.pool_entries e join public.profiles pr on pr.id = e.user_id
                            where e.pool_id = p.id and e.option_id = p.resolved_option and pr.handle is not null), '[]'))
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status = 'resolved'
$$;

-- 3. Crew standings -------------------------------------------------------------------------------
-- Per member for a period ('month' = this calendar month, 'all' = everything): pools played, calls won,
-- net coins, current win streak (most recent settled pools first).
create or replace function public.crew_standings(p_group uuid, p_period text default 'month') returns jsonb
language sql stable security definer set search_path = public as $$
  with settled as (
    select p.id, p.resolved_option, coalesce(p.proposed_at, p.created_at) as at,
           (select sum(stake) from public.pool_entries where pool_id = p.id) as pot,
           (select count(*) from public.pool_entries where pool_id = p.id and option_id = p.resolved_option) as winners
    from public.pools p
    where p.group_id = p_group and p.status = 'resolved'
      and (p_period = 'all' or coalesce(p.proposed_at, p.created_at) >= date_trunc('month', now()))
  ), plays as (
    select e.user_id, s.at, (e.option_id = s.resolved_option) as won,
           case when e.option_id = s.resolved_option then floor(s.pot::numeric / s.winners)::bigint - e.stake else -e.stake end as net
    from settled s join public.pool_entries e on e.pool_id = s.id
  ), streaks as (
    select user_id, count(*) as streak from (
      select user_id, won, sum(case when won then 0 else 1 end) over (partition by user_id order by at desc) as losses_before
      from plays) x
    where losses_before = 0 and won group by user_id
  )
  select case when not public.is_member(p_group) then null else coalesce((
    select jsonb_agg(jsonb_build_object('user', m.user_id, 'played', coalesce(a.played, 0), 'won', coalesce(a.won, 0),
                                        'net', coalesce(a.net, 0), 'streak', coalesce(st.streak, 0))
                     order by coalesce(a.net, 0) desc, coalesce(a.won, 0) desc, m.joined_at)
    from public.group_members m
    left join (select user_id, count(*) played, count(*) filter (where won) won, sum(net) net from plays group by user_id) a on a.user_id = m.user_id
    left join streaks st on st.user_id = m.user_id
    where m.group_id = p_group
      and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = m.user_id)
  ), '[]') end
$$;

-- 4. JAM- invite codes (old BND- codes keep working) ------------------------------------------------
create or replace function public.ensure_invite_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  loop
    v_code := 'JAM-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
                         from (select extensions.gen_random_bytes(4) b) r, generate_series(0, 3) i);
    exit when not exists (select 1 from public.invite_codes where code = v_code);
  end loop;
  insert into public.invite_codes (code, owner) values (v_code, new.id);
  return new;
end $$;

-- 5. Two more funnel events ----------------------------------------------------------------------
create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'first_run_skipped', 'result_shared', 'standings_viewed') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;

grant execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text), public.stop_repeat(uuid),
  public.crew_standings(uuid, text), public.my_pools() to authenticated;
grant execute on function public.result_preview(uuid) to anon, authenticated;
revoke execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text), public.stop_repeat(uuid),
  public.crew_standings(uuid, text) from public, anon;
