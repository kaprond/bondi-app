-- "Loser buys the drinks": an optional real-life stake on a pool. Text only; LetsJam never moves money,
-- so anything that reads like a payment (amounts, currencies, payment apps) is refused.

alter table public.pools add column if not exists forfeit text check (char_length(forfeit) <= 60);

create or replace function public.forfeit_problem(p_text text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_text is null then null
    when char_length(trim(p_text)) < 3 then 'make the real-life stake a bit longer.'
    when char_length(trim(p_text)) > 60 then 'keep the real-life stake under 60 characters.'
    when p_text ~* '(€|\$|£|\y(eur|euro|euros|cash|money|geld|tikkie|bunq|paypal|revolut|venmo|iban|pay|pays|paid|payment|betaal\w*|transfer|overmaken|bet|bets|wager)\y)'
      then 'no money in real-life stakes. keep it to things like buying a round or doing the dishes.'
    when public.blocked_topic(p_text) is not null then 'real-life stakes about ' || public.blocked_topic(p_text) || ' aren’t allowed.'
  end
$$;

drop function if exists public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text);
create or replace function public.create_pool(p_group uuid, p_question text, p_stake bigint, p_options jsonb,
                                              p_subject uuid default null, p_closes_at timestamptz default null,
                                              p_repeat text default null, p_forfeit text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_topic text; o jsonb; v_n int; v_forfeit text := nullif(trim(coalesce(p_forfeit, '')), '');
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
  if public.forfeit_problem(v_forfeit) is not null then raise exception '%', public.forfeit_problem(v_forfeit); end if;
  v_topic := public.blocked_topic(p_question || ' ' || (select string_agg(x->>'label', ' ') from jsonb_array_elements(p_options) x));
  if v_topic is not null then raise exception 'pools about % aren’t allowed. keep it fun for everyone.', v_topic; end if;
  if p_subject is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = p_subject) then
    raise exception 'the person it’s about has to be in the crew.'; end if;
  if p_subject = v_me then raise exception 'you can’t make a pool about yourself.'; end if;

  insert into public.pools (group_id, created_by, question, stake, subject_user_id, status, closes_at, repeat, forfeit)
    values (p_group, v_me, trim(p_question), p_stake, p_subject,
            case when p_subject is null then 'open' else 'pending_consent' end::pool_status, p_closes_at, p_repeat, v_forfeit)
    returning id into v_id;
  for o in select * from jsonb_array_elements(p_options) loop
    if length(trim(coalesce(o->>'label', ''))) = 0 then raise exception 'outcomes can’t be empty.'; end if;
    if (o->>'member') is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = (o->>'member')::uuid) then
      raise exception 'everyone named in an outcome has to be in the crew.'; end if;
    insert into public.pool_options (pool_id, label, member_user_id) values (v_id, trim(o->>'label'), (o->>'member')::uuid);
  end loop;
  return v_id;
end $$;

-- Weekly rounds keep the real-life stake.
create or replace function public.spawn_rounds() returns void
language plpgsql security definer set search_path = public as $$
declare p record; v_id uuid; v_close timestamptz;
begin
  for p in select * from public.pools where repeat = 'weekly' and not repeat_spawned and closes_at < now() loop
    update public.pools set repeat_spawned = true where id = p.id;
    if not exists (select 1 from public.group_members where group_id = p.group_id and user_id = p.created_by) then continue; end if;
    v_close := p.closes_at + interval '7 days';
    while v_close < now() + interval '1 hour' loop v_close := v_close + interval '7 days'; end loop;
    insert into public.pools (group_id, created_by, question, stake, status, closes_at, repeat, round, forfeit)
      values (p.group_id, p.created_by, p.question, p.stake, 'open', v_close, 'weekly', p.round + 1, p.forfeit) returning id into v_id;
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

create or replace function public.my_pools() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'group_id', p.group_id, 'group_name', g.name, 'question', p.question, 'stake', p.stake,
    'created_by', p.created_by, 'subject', p.subject_user_id, 'status', p.status, 'closes_at', p.closes_at,
    'proposed', p.proposed_option, 'proposed_at', p.proposed_at, 'resolved', p.resolved_option,
    'repeat', p.repeat, 'round', p.round, 'forfeit', p.forfeit,
    'comments', (select count(*) from public.pool_comments c where c.pool_id = p.id),
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'member', o.member_user_id) order by o.label), '[]') from public.pool_options o where o.pool_id = p.id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('user', e.user_id, 'option', e.option_id)), '[]') from public.pool_entries e where e.pool_id = p.id),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('user', v.user_id, 'confirm', v.confirm)), '[]') from public.pool_votes v where v.pool_id = p.id)
  ) order by p.created_at desc), '[]')
  from public.pools p join public.groups g on g.id = p.group_id
  where public.is_member(p.group_id) and p.created_at > now() - interval '60 days'
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = p.created_by)
$$;

create or replace function public.result_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question, 'crew', g.name, 'emoji', g.emoji, 'round', p.round, 'forfeit', p.forfeit,
    'winner', (select label from public.pool_options where id = p.resolved_option),
    'pot', (select coalesce(sum(stake), 0) from public.pool_entries where pool_id = p.id),
    'players', (select count(*) from public.pool_entries where pool_id = p.id),
    'called_it', coalesce((select jsonb_agg(pr.handle order by e.created_at) from public.pool_entries e join public.profiles pr on pr.id = e.user_id
                            where e.pool_id = p.id and e.option_id = p.resolved_option and pr.handle is not null), '[]'))
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status = 'resolved'
$$;

create or replace function public.pool_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question, 'crew', g.name, 'forfeit', p.forfeit,
    'pot', (select count(*) from public.pool_entries e where e.pool_id = p.id) * p.stake,
    'stake', p.stake,
    'by', (select handle from public.profiles where id = p.created_by),
    'status', p.status)
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status in ('pending_consent', 'open', 'proposed')
$$;

grant execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text, text) to authenticated;
revoke execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.result_preview(uuid), public.pool_preview(uuid) to anon, authenticated;
