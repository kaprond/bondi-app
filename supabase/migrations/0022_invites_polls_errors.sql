-- 0022: richer crew invite previews, quick polls (no coins), client error reports.

-- 1. Crew invite preview: faces, open pools, who's on top.
create or replace function public.crew_preview(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', g.name, 'emoji', g.emoji,
    'members', (select count(*) from public.group_members m where m.group_id = g.id),
    'faces', coalesce((select jsonb_agg(jsonb_build_object('emoji', pr.avatar_emoji, 'color', pr.avatar_color, 'handle', pr.handle) order by m.joined_at)
                       from (select * from public.group_members where group_id = g.id order by joined_at limit 6) m
                       join public.profiles pr on pr.id = m.user_id), '[]'),
    'open_pools', (select count(*) from public.pools p where p.group_id = g.id and p.status = 'open' and (p.closes_at is null or p.closes_at > now())),
    'top', (select jsonb_build_object('handle', pr.handle, 'won', x.won)
            from (select e.user_id, count(*) as won from public.pools p join public.pool_entries e on e.pool_id = p.id
                  where p.group_id = g.id and p.status = 'resolved' and e.option_id = p.resolved_option
                  group by e.user_id order by won desc limit 1) x
            join public.profiles pr on pr.id = x.user_id where pr.handle is not null))
  from public.groups g where g.id = p_group
$$;
grant execute on function public.crew_preview(uuid) to anon, authenticated;

-- 2. Quick polls: a crew votes, no coins, no settling. You can change your vote until it closes.
create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups on delete cascade,
  created_by uuid references public.profiles on delete set null,
  question   text not null check (char_length(question) between 3 and 100),
  options    text[] not null check (cardinality(options) between 2 and 6),
  closes_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists polls_group on public.polls (group_id, created_at desc);
alter table public.polls enable row level security;
drop policy if exists member_polls on public.polls;
create policy member_polls on public.polls for select using (public.is_member(group_id));

create table if not exists public.poll_votes (
  poll_id  uuid not null references public.polls on delete cascade,
  user_id  uuid not null references public.profiles on delete cascade,
  option   smallint not null,
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table public.poll_votes enable row level security;
drop policy if exists member_poll_votes on public.poll_votes;
create policy member_poll_votes on public.poll_votes for select using (
  exists (select 1 from public.polls p where p.id = poll_id and public.is_member(p.group_id)));

do $$ begin alter publication supabase_realtime add table public.polls, public.poll_votes; exception when duplicate_object then null; end $$;

create or replace function public.create_poll(p_group uuid, p_question text, p_options text[], p_closes_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_topic text; v_id uuid; v_opts text[]; v_to uuid[]; v_name text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_group) then raise exception 'crew not found'; end if;
  select array_agg(left(trim(o), 40)) into v_opts from unnest(p_options) o where length(trim(o)) > 0;
  if length(trim(coalesce(p_question, ''))) < 3 then raise exception 'write a question first.'; end if;
  if coalesce(cardinality(v_opts), 0) < 2 then raise exception 'add at least 2 options.'; end if;
  if cardinality(v_opts) > 6 then raise exception 'max 6 options.'; end if;
  v_topic := public.blocked_topic(p_question || ' ' || array_to_string(v_opts, ' '));
  if v_topic is not null then raise exception 'polls about % aren’t allowed.', v_topic; end if;
  if p_closes_at is not null and p_closes_at < now() + interval '5 minutes' then raise exception 'pick a later deadline.'; end if;
  if (select count(*) from public.polls where created_by = v_me and created_at > now() - interval '1 hour') >= 10 then raise exception 'slow down a bit.'; end if;
  insert into public.polls (group_id, created_by, question, options, closes_at) values (p_group, v_me, left(trim(p_question), 100), v_opts, p_closes_at) returning id into v_id;
  select name into v_name from public.groups where id = p_group;
  select array_agg(m.user_id) into v_to from public.group_members m
   where m.group_id = p_group and m.user_id <> v_me and not public.is_blocked_between(m.user_id, v_me);
  perform public.push_to(v_to, '📊 ' || v_name || ': quick poll', public.handle_of(v_me) || ' asks: ' || left(trim(p_question), 90), jsonb_build_object('go', 'crew', 'id', p_group));
  return v_id;
end $$;
grant execute on function public.create_poll(uuid, text, text[], timestamptz) to authenticated;

create or replace function public.vote_poll(p_poll uuid, p_option int) returns void
language plpgsql security definer set search_path = public as $$
declare v_poll public.polls;
begin
  select * into v_poll from public.polls where id = p_poll;
  if not found or not public.is_member(v_poll.group_id) then raise exception 'poll not found'; end if;
  if v_poll.closes_at is not null and v_poll.closes_at <= now() then raise exception 'this poll closed.'; end if;
  if p_option < 0 or p_option >= cardinality(v_poll.options) then raise exception 'pick one of the options.'; end if;
  insert into public.poll_votes (poll_id, user_id, option) values (p_poll, auth.uid(), p_option)
    on conflict (poll_id, user_id) do update set option = excluded.option, voted_at = now();
end $$;
grant execute on function public.vote_poll(uuid, int) to authenticated;

create or replace function public.delete_poll(p_poll uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.polls where id = p_poll and created_by = auth.uid()
$$;
grant execute on function public.delete_poll(uuid) to authenticated;

-- every poll in your crews, last 30 days, with counts and your vote
create or replace function public.my_polls() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'group_id', p.group_id, 'group_name', g.name, 'created_by', p.created_by, 'question', p.question,
    'options', p.options, 'closes_at', p.closes_at, 'created_at', p.created_at,
    'counts', (select coalesce(jsonb_agg(c order by i), '[]') from (
                 select i, (select count(*) from public.poll_votes v where v.poll_id = p.id and v.option = i - 1) as c
                 from generate_series(1, cardinality(p.options)) i) z),
    'voters', (select coalesce(jsonb_agg(v.user_id order by v.voted_at), '[]') from public.poll_votes v where v.poll_id = p.id),
    'mine', (select v.option from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid())
  ) order by p.created_at desc), '[]')
  from public.polls p join public.groups g on g.id = p.group_id
  where public.is_member(p.group_id) and p.created_at > now() - interval '30 days'
$$;
grant execute on function public.my_polls() to authenticated;

-- crew feed: polls too (rest unchanged from 0021)
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
    union all
    select 'poll', pl.created_at, pl.created_by, null, pl.id, pl.question,
           (select count(*) from public.poll_votes v where v.poll_id = pl.id)::text, 'q' || pl.id
      from public.polls pl where pl.group_id = p_group
  ), recent as (
    select * from items where at <= now() order by at desc limit 80
  )
  select case when not public.is_member(p_group) then null else
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'at', at, 'user', "user", 'body', body, 'pool', pool, 'question', question, 'extra', extra) order by at) from recent), '[]')
  end
$$;
grant execute on function public.crew_feed(uuid) to authenticated;

-- 3. Client error reports: what broke, where, which version. No personal data beyond the user id.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles on delete set null,
  message    text not null,
  stack      text,
  context    jsonb not null default '{}',
  platform   text,
  version    text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time on public.client_errors (created_at desc);
alter table public.client_errors enable row level security; -- no policies: write via RPC, read via admin report

create or replace function public.log_client_error(p_message text, p_stack text default null, p_context jsonb default '{}', p_platform text default null, p_version text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or length(trim(coalesce(p_message, ''))) = 0 then return; end if;
  if (select count(*) from public.client_errors where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then return; end if;
  insert into public.client_errors (user_id, message, stack, context, platform, version)
  values (auth.uid(), left(p_message, 500), left(p_stack, 4000), coalesce(p_context, '{}'), left(p_platform, 10), left(p_version, 20));
end $$;
grant execute on function public.log_client_error(text, text, jsonb, text, text) to authenticated;

create or replace function public.error_report(p_key text, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
begin
  if p_key is null or p_key <> (select value from public.app_secrets where name = 'funnel') then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.n desc), '[]') from (
    select left(message, 160) as message, count(*) as n, count(distinct user_id) as users, max(created_at) as last_seen,
           string_agg(distinct coalesce(platform, '?'), ', ') as platforms, string_agg(distinct coalesce(version, '?'), ', ') as versions,
           (array_agg(left(stack, 600) order by created_at desc))[1] as stack, (array_agg(context order by created_at desc))[1] as context
    from public.client_errors where created_at >= v_since
    group by left(message, 160) order by count(*) desc limit 40) x);
end $$;
revoke execute on function public.error_report(text, int) from public, authenticated;
grant execute on function public.error_report(text, int) to anon;

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
                    'poll_created', 'poll_voted', 'crew_qr_shown') then return; end if;
  if (select count(*) from public.events where user_id = auth.uid() and created_at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.events (user_id, name, props, platform) values (auth.uid(), p_name, coalesce(p_props, '{}'), left(p_platform, 10));
end $$;
