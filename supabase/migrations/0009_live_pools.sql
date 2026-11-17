-- Friend pools go live: create pools server-side, one-call snapshots for the app, auto-settle.
-- Coins stay free-to-play: no cash value, can't be bought or cashed out.

-- Topic filter. Same list as src/moderation.ts (\y is a word boundary in Postgres regex).
create or replace function public.blocked_topic(p_text text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_text ~* '\y(pass(es|ed)? out|blackout|drunk|wasted|vomit|puke|shots?|hangover|high|stoned|overdose)\y' then 'drinking or drugs'
    when p_text ~* '\y(hospital|injur\w*|break (a|his|her) |sick|die|dies|death|hurt)\y' then 'health or injury'
    when p_text ~* '\y(girlfriend|boyfriend|hook ?up|sleep with|sex|dating|date with|ex|kiss)\y' then 'sex or dating'
    when p_text ~* '\y(fat|ugly|weight|blonde|brunette|hot|looks)\y' then 'appearance'
    when p_text ~* '\y(arrest\w*|police|steal|fight|crash|jump off)\y' then 'crime or danger'
    when p_text ~* '\y(self.?harm|suicid\w*|cut (him|her)self)\y' then 'self-harm'
  end
$$;

-- p_options: [{"label": "...", "member": "<uuid or null>"}, ...]
create or replace function public.create_pool(p_group uuid, p_question text, p_stake bigint, p_options jsonb, p_subject uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_topic text; o jsonb; v_n int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_group) then raise exception 'you’re not in that crew'; end if;
  if length(trim(coalesce(p_question, ''))) < 5 then raise exception 'ask a question.'; end if;
  v_n := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  if v_n < 2 or v_n > 6 then raise exception 'add 2 to 6 outcomes.'; end if;
  v_topic := public.blocked_topic(p_question || ' ' || (select string_agg(x->>'label', ' ') from jsonb_array_elements(p_options) x));
  if v_topic is not null then raise exception 'pools about % aren’t allowed. keep it fun for everyone.', v_topic; end if;
  if p_subject is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = p_subject) then
    raise exception 'the person it’s about has to be in the crew.'; end if;
  if p_subject = v_me then raise exception 'you can’t make a pool about yourself.'; end if;

  insert into public.pools (group_id, created_by, question, stake, subject_user_id, status)
    values (p_group, v_me, trim(p_question), p_stake, p_subject, case when p_subject is null then 'open' else 'pending_consent' end::pool_status)
    returning id into v_id;
  for o in select * from jsonb_array_elements(p_options) loop
    if length(trim(coalesce(o->>'label', ''))) = 0 then raise exception 'outcomes can’t be empty.'; end if;
    if (o->>'member') is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = (o->>'member')::uuid) then
      raise exception 'everyone named in an outcome has to be in the crew.'; end if;
    insert into public.pool_options (pool_id, label, member_user_id) values (v_id, trim(o->>'label'), (o->>'member')::uuid);
  end loop;
  return v_id;
end $$;

-- Everything the app needs about you and your people in one call.
create or replace function public.my_social() returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id),
  rel as (
    select case when f.requester = me.id then f.addressee else f.requester end as other,
           case when f.status = 'accepted' then 'friend' when f.requester = me.id then 'outgoing' else 'incoming' end as kind
    from public.friendships f, me where me.id in (f.requester, f.addressee)
  ),
  my_groups as (select g.* from public.groups g join public.group_members m on m.group_id = g.id, me where m.user_id = me.id),
  known as (
    select other as id from rel
    union select m.user_id from public.group_members m join my_groups g on g.id = m.group_id
    union select id from me
  )
  select jsonb_build_object(
    'me', (select id from me),
    'code', (select code from public.invite_codes, me where owner = me.id),
    'people', coalesce((select jsonb_agg(to_jsonb(p)) from public.public_profiles p where p.id in (select id from known)), '[]'),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', other, 'kind', kind)) from rel), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'emoji', g.emoji,
               'members', (select jsonb_agg(m.user_id) from public.group_members m where m.group_id = g.id))) from my_groups g), '[]')
  )
$$;

-- All pools in your crews, with options, entries and votes.
create or replace function public.my_pools() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'group_id', p.group_id, 'group_name', g.name, 'question', p.question, 'stake', p.stake,
    'created_by', p.created_by, 'subject', p.subject_user_id, 'status', p.status,
    'proposed', p.proposed_option, 'proposed_at', p.proposed_at, 'resolved', p.resolved_option,
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'member', o.member_user_id) order by o.label), '[]') from public.pool_options o where o.pool_id = p.id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('user', e.user_id, 'option', e.option_id)), '[]') from public.pool_entries e where e.pool_id = p.id),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('user', v.user_id, 'confirm', v.confirm)), '[]') from public.pool_votes v where v.pool_id = p.id)
  ) order by p.created_at desc), '[]')
  from public.pools p join public.groups g on g.id = p.group_id
  where public.is_member(p.group_id) and p.created_at > now() - interval '60 days'
$$;

-- Cancel a request you sent (remove_friend also works, this one only touches pending).
create or replace function public.cancel_friend_request(p_to uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friendships where requester = auth.uid() and addressee = p_to and status = 'pending'
$$;

-- People search by handle or name, max 10.
create or replace function public.search_people(p_q text) returns setof public.public_profiles
language sql stable security definer set search_path = public as $$
  select * from public.public_profiles
  where length(trim(p_q)) >= 2 and id <> auth.uid()
    and (handle ilike trim(leading '@' from lower(trim(p_q))) || '%' or display_name ilike lower(trim(p_q)) || '%')
  order by handle limit 10
$$;

grant execute on function public.create_pool(uuid, text, bigint, jsonb, uuid), public.my_social(), public.my_pools(),
  public.cancel_friend_request(uuid), public.search_people(text) to authenticated;

-- Settle pools whose 48-hour confirm window is over, every 10 minutes.
create extension if not exists pg_cron;
select cron.schedule('finalize-pools', '*/10 * * * *',
  $$ select public.finalize_pool(id) from public.pools where status = 'proposed' and proposed_at < now() - interval '48 hours' $$);
