-- Engagement batch: pool deadlines + reminders, trash talk (comments + reactions),
-- crew invite links for the first-run flow, and our own funnel analytics.

-- 1. Deadlines -----------------------------------------------------------------------------------
alter table public.pools add column if not exists reminded_close boolean not null default false,
                         add column if not exists reminded_result boolean not null default false;

-- create_pool gains an optional deadline (15 minutes to 30 days out). The old 5-argument
-- version is replaced, so calls without a deadline keep working through the default.
drop function if exists public.create_pool(uuid, text, bigint, jsonb, uuid);
create or replace function public.create_pool(p_group uuid, p_question text, p_stake bigint, p_options jsonb,
                                              p_subject uuid default null, p_closes_at timestamptz default null) returns uuid
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
  v_topic := public.blocked_topic(p_question || ' ' || (select string_agg(x->>'label', ' ') from jsonb_array_elements(p_options) x));
  if v_topic is not null then raise exception 'pools about % aren’t allowed. keep it fun for everyone.', v_topic; end if;
  if p_subject is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = p_subject) then
    raise exception 'the person it’s about has to be in the crew.'; end if;
  if p_subject = v_me then raise exception 'you can’t make a pool about yourself.'; end if;

  insert into public.pools (group_id, created_by, question, stake, subject_user_id, status, closes_at)
    values (p_group, v_me, trim(p_question), p_stake, p_subject,
            case when p_subject is null then 'open' else 'pending_consent' end::pool_status, p_closes_at)
    returning id into v_id;
  for o in select * from jsonb_array_elements(p_options) loop
    if length(trim(coalesce(o->>'label', ''))) = 0 then raise exception 'outcomes can’t be empty.'; end if;
    if (o->>'member') is not null and not exists (select 1 from public.group_members where group_id = p_group and user_id = (o->>'member')::uuid) then
      raise exception 'everyone named in an outcome has to be in the crew.'; end if;
    insert into public.pool_options (pool_id, label, member_user_id) values (v_id, trim(o->>'label'), (o->>'member')::uuid);
  end loop;
  return v_id;
end $$;

-- Reminders, every 15 minutes: "closes in an hour" to crew members who haven't joined,
-- and "time to call it" to the creator an hour after the deadline.
create or replace function public.pool_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare p record; v_to uuid[];
begin
  for p in select * from public.pools
           where status = 'open' and not reminded_close and closes_at between now() + interval '30 minutes' and now() + interval '75 minutes'
  loop
    select array_agg(m.user_id) into v_to from public.group_members m
     where m.group_id = p.group_id and m.user_id is distinct from p.subject_user_id
       and not exists (select 1 from public.pool_entries e where e.pool_id = p.id and e.user_id = m.user_id);
    perform public.push_to(v_to, 'closes in an hour ⏰', p.question || ' — make your call', jsonb_build_object('go', 'pool', 'id', p.id));
    update public.pools set reminded_close = true where id = p.id;
  end loop;
  for p in select * from public.pools
           where status = 'open' and not reminded_result and closes_at < now() - interval '1 hour' and created_by is not null
  loop
    perform public.push_to(array[p.created_by], 'time to call it 🏁', 'who won? ' || p.question, jsonb_build_object('go', 'pool', 'id', p.id));
    update public.pools set reminded_result = true where id = p.id;
  end loop;
end $$;
revoke execute on function public.pool_reminders() from public, anon, authenticated;
select cron.schedule('pool-reminders', '*/15 * * * *', 'select public.pool_reminders()');

-- 2. Trash talk -------------------------------------------------------------------------------
create table if not exists public.pool_comments (
  id         bigint generated always as identity primary key,
  pool_id    uuid not null references public.pools on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists pool_comments_pool on public.pool_comments (pool_id, created_at);
alter table public.pool_comments enable row level security;
create policy member_comments on public.pool_comments for select using (
  exists (select 1 from public.pools p where p.id = pool_id and public.is_member(p.group_id))
  and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = user_id));

create table if not exists public.pool_reactions (
  pool_id    uuid not null references public.pools on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  emoji      text not null check (emoji in ('🔥', '😂', '😱', '👀', '🫡', '💀')),
  created_at timestamptz not null default now(),
  primary key (pool_id, user_id, emoji)
);
alter table public.pool_reactions enable row level security;
create policy member_reactions on public.pool_reactions for select using (
  exists (select 1 from public.pools p where p.id = pool_id and public.is_member(p.group_id)));

create or replace function public.add_comment(p_pool uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_pool public.pools; v_topic text; v_id bigint; v_to uuid[];
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_pool from public.pools where id = p_pool;
  if not found or not public.is_member(v_pool.group_id) then raise exception 'pool not found'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'say something first.'; end if;
  v_topic := public.blocked_topic(p_body);
  if v_topic is not null then raise exception 'keep it fun: no %.', v_topic; end if;
  if (select count(*) from public.pool_comments where user_id = v_me and created_at > now() - interval '1 minute') >= 8 then
    raise exception 'slow down a bit.'; end if;
  insert into public.pool_comments (pool_id, user_id, body) values (p_pool, v_me, left(trim(p_body), 280)) returning id into v_id;
  -- tell the creator and everyone in the pool, except you and anyone who blocked you
  select array_agg(distinct u) into v_to from (
    select v_pool.created_by as u union select e.user_id from public.pool_entries e where e.pool_id = p_pool) x
   where u is not null and u <> v_me and not public.is_blocked_between(u, v_me);
  perform public.push_to(v_to, public.handle_of(v_me) || ' 💬 ' || left(v_pool.question, 40), left(trim(p_body), 120), jsonb_build_object('go', 'pool', 'id', p_pool));
  return v_id;
end $$;

create or replace function public.delete_comment(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from public.pool_comments where id = p_id and user_id = auth.uid()
$$;

create or replace function public.toggle_reaction(p_pool uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.pools p where p.id = p_pool and public.is_member(p.group_id)) then raise exception 'pool not found'; end if;
  delete from public.pool_reactions where pool_id = p_pool and user_id = v_me and emoji = p_emoji;
  if found then return false; end if;
  insert into public.pool_reactions (pool_id, user_id, emoji) values (p_pool, v_me, p_emoji);
  return true;
end $$;

-- Everything the pool screen needs for the thread, in one call.
create or replace function public.pool_thread(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.pools p where p.id = p_pool and public.is_member(p.group_id)) then null else jsonb_build_object(
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'user', c.user_id, 'body', c.body, 'at', c.created_at) order by c.created_at)
       from public.pool_comments c where c.pool_id = p_pool
        and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = c.user_id)), '[]'),
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n, 'mine', r.mine))
       from (select emoji, count(*) n, bool_or(user_id = auth.uid()) mine from public.pool_reactions where pool_id = p_pool group by emoji) r), '[]')
  ) end
$$;

alter publication supabase_realtime add table public.pool_comments, public.pool_reactions;

-- my_pools also returns the deadline
create or replace function public.my_pools() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'group_id', p.group_id, 'group_name', g.name, 'question', p.question, 'stake', p.stake,
    'created_by', p.created_by, 'subject', p.subject_user_id, 'status', p.status, 'closes_at', p.closes_at,
    'proposed', p.proposed_option, 'proposed_at', p.proposed_at, 'resolved', p.resolved_option,
    'comments', (select count(*) from public.pool_comments c where c.pool_id = p.id),
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'member', o.member_user_id) order by o.label), '[]') from public.pool_options o where o.pool_id = p.id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('user', e.user_id, 'option', e.option_id)), '[]') from public.pool_entries e where e.pool_id = p.id),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('user', v.user_id, 'confirm', v.confirm)), '[]') from public.pool_votes v where v.pool_id = p.id)
  ) order by p.created_at desc), '[]')
  from public.pools p join public.groups g on g.id = p.group_id
  where public.is_member(p.group_id) and p.created_at > now() - interval '60 days'
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = p.created_by)
$$;

-- 3. Crew invite links (first-run flow) ----------------------------------------------------------
-- /?crew=<id>&i=<code>: joins that crew if the code belongs to one of its members, and you
-- become friends with them. Same rules as pool links.
create or replace function public.join_crew_link(p_group uuid, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select owner into v_owner from public.invite_codes where code = upper(trim(p_code));
  if v_owner is null or not exists (select 1 from public.group_members where group_id = p_group and user_id = v_owner) then
    raise exception 'this crew link has expired'; end if;
  if v_owner <> v_me and public.is_blocked_between(v_me, v_owner) then raise exception 'this crew link has expired'; end if;
  insert into public.group_members (group_id, user_id) values (p_group, v_me) on conflict do nothing;
  if v_owner <> v_me and not exists (select 1 from public.friendships
      where (requester = v_me and addressee = v_owner) or (requester = v_owner and addressee = v_me)) then
    insert into public.friendships (requester, addressee, status, accepted_at) values (v_owner, v_me, 'accepted', now());
  end if;
  perform public.push_to(array(select m.user_id from public.group_members m where m.group_id = p_group and m.user_id <> v_me),
    'new in the crew 👋', public.handle_of(v_me) || ' joined ' || (select name from public.groups where id = p_group), jsonb_build_object('go', 'pools'));
  return p_group;
end $$;

create or replace function public.crew_preview(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', g.name, 'emoji', g.emoji, 'members', (select count(*) from public.group_members m where m.group_id = g.id))
  from public.groups g where g.id = p_group
$$;

-- 4. Funnel analytics (first-party, no third parties) -------------------------------------------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles on delete cascade,
  name       text not null,
  props      jsonb not null default '{}',
  platform   text,
  created_at timestamptz not null default now()
);
create index if not exists events_name_time on public.events (name, created_at);
alter table public.events enable row level security; -- no policies: nobody reads it through the API

create or replace function public.track(p_name text, p_props jsonb default '{}', p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_name not in ('app_open', 'welcome_done', 'profile_done', 'crew_created', 'invite_shared', 'crew_link_opened',
                    'pool_created', 'pool_joined', 'pool_link_opened', 'pool_shared', 'comment_posted',
                    'account_saved', 'push_enabled', 'first_run_skipped') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;

-- Funnel per signup week: how many got to each step (read it in the Supabase SQL editor).
create or replace view public.funnel_weekly with (security_invoker = true) as
with firsts as (
  select user_id, name, min(created_at) at from public.events group by 1, 2
), cohort as (
  select user_id, date_trunc('week', at)::date as week from firsts where name = 'welcome_done'
)
select c.week,
  count(*) as signed_up,
  count(*) filter (where exists (select 1 from firsts f where f.user_id = c.user_id and f.name = 'profile_done')) as made_profile,
  count(*) filter (where exists (select 1 from firsts f where f.user_id = c.user_id and f.name in ('crew_created', 'crew_link_opened', 'pool_link_opened'))) as in_a_crew,
  count(*) filter (where exists (select 1 from firsts f where f.user_id = c.user_id and f.name = 'invite_shared')) as invited,
  count(*) filter (where exists (select 1 from firsts f where f.user_id = c.user_id and f.name in ('pool_created', 'pool_joined'))) as played_a_pool,
  count(*) filter (where exists (select 1 from firsts f where f.user_id = c.user_id and f.name = 'account_saved')) as saved_account
from cohort c group by 1 order by 1 desc;
revoke all on public.funnel_weekly from anon, authenticated;

grant execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz), public.add_comment(uuid, text),
  public.delete_comment(bigint), public.toggle_reaction(uuid, text), public.pool_thread(uuid), public.my_pools(),
  public.join_crew_link(uuid, text), public.track(text, jsonb, text) to authenticated;
grant execute on function public.crew_preview(uuid) to anon, authenticated;
revoke execute on function public.create_pool(uuid, text, bigint, jsonb, uuid, timestamptz), public.add_comment(uuid, text),
  public.delete_comment(bigint), public.toggle_reaction(uuid, text), public.pool_thread(uuid), public.my_pools(),
  public.join_crew_link(uuid, text), public.track(text, jsonb, text) from public, anon;
