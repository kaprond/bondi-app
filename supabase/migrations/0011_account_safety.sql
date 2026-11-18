-- App Store requirements: delete your account in the app (5.1.1(v)), and report + block for
-- user-generated pools (1.2). Coins stay free-to-play.

-- 1. Deleting a profile must not be blocked by pools/crews/reports that point at it.
alter table public.pools  alter column created_by drop not null;
alter table public.groups alter column created_by drop not null;

alter table public.pools        drop constraint pools_created_by_fkey,
  add constraint pools_created_by_fkey foreign key (created_by) references public.profiles on delete set null;
alter table public.pools        drop constraint pools_subject_user_id_fkey,
  add constraint pools_subject_user_id_fkey foreign key (subject_user_id) references public.profiles on delete set null;
alter table public.pool_options drop constraint pool_options_member_user_id_fkey,
  add constraint pool_options_member_user_id_fkey foreign key (member_user_id) references public.profiles on delete set null;
alter table public.groups       drop constraint groups_created_by_fkey,
  add constraint groups_created_by_fkey foreign key (created_by) references public.profiles on delete set null;
alter table public.reports      drop constraint reports_reporter_fkey,
  add constraint reports_reporter_fkey foreign key (reporter) references public.profiles on delete set null;

-- 2. Reports can be about a pool, a person, or both.
alter table public.reports
  add column if not exists reported_user uuid references public.profiles on delete set null,
  add column if not exists status text not null default 'open' check (status in ('open', 'actioned', 'dismissed'));
alter table public.reports add constraint reports_reason_len check (char_length(reason) between 1 and 300);
create index if not exists reports_open on public.reports (created_at) where status = 'open';

-- 3. Blocks: one-way. Blocking also ends any friendship or request between you two.
create table if not exists public.blocks (
  blocker    uuid not null references public.profiles on delete cascade,
  blocked    uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
create policy own_blocks on public.blocks for select using (blocker = auth.uid());

create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;

create or replace function public.block_user(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_other is null or p_other = v_me then raise exception 'you can’t block yourself'; end if;
  insert into public.blocks (blocker, blocked) values (v_me, p_other) on conflict do nothing;
  delete from public.friendships
   where (requester = v_me and addressee = p_other) or (requester = p_other and addressee = v_me);
end $$;

create or replace function public.unblock_user(p_other uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.blocks where blocker = auth.uid() and blocked = p_other
$$;

create or replace function public.my_blocks() returns setof public.public_profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.public_profiles p join public.blocks b on b.blocked = p.id where b.blocker = auth.uid()
$$;

-- Report a pool and/or a person. Max 20 reports a day per player.
create or replace function public.report_content(p_pool uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_pool is null and p_user is null then raise exception 'nothing to report'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'pick a reason'; end if;
  if p_pool is not null and not exists (select 1 from public.pools p where p.id = p_pool and public.is_member(p.group_id)) then
    raise exception 'pool not found'; end if;
  if (select count(*) from public.reports where reporter = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'that’s a lot of reports today. we’re on it.'; end if;
  insert into public.reports (pool_id, reporter, reported_user, reason) values (p_pool, v_me, p_user, left(trim(p_reason), 300));
end $$;

-- 4. Blocked people disappear: their pools, search results and friend requests.
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
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = p.created_by)
$$;

create or replace function public.search_people(p_q text) returns setof public.public_profiles
language sql stable security definer set search_path = public as $$
  select * from public.public_profiles
  where length(trim(p_q)) >= 2 and id <> auth.uid()
    and not public.is_blocked_between(auth.uid(), id)
    and (handle ilike trim(leading '@' from lower(trim(p_q))) || '%' or display_name ilike lower(trim(p_q)) || '%')
  order by handle limit 10
$$;

create or replace function public.send_friend_request(p_handle text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_them uuid; v_reverse public.friendships;
begin
  select id into v_them from public.profiles where handle = lower(trim(leading '@' from p_handle));
  if v_them is null or public.is_blocked_between(v_me, v_them) then raise exception 'no one with that handle'; end if;
  if v_them = v_me then raise exception 'that is you'; end if;
  select * into v_reverse from public.friendships where requester = v_them and addressee = v_me;
  if found then
    update public.friendships set status = 'accepted', accepted_at = now() where requester = v_them and addressee = v_me;
    return;
  end if;
  insert into public.friendships (requester, addressee) values (v_me, v_them) on conflict do nothing;
end $$;

-- 5. Delete your account. Unsettled pools you made or that are about you get cancelled and
-- everyone else's coins go back; then the auth user goes, and everything of yours cascades.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := auth.uid(); v_pool uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  for v_pool in
    select id from public.pools
     where (created_by = v_me or subject_user_id = v_me)
       and status in ('pending_consent', 'open', 'locked', 'proposed')
     for update
  loop
    insert into public.ledger (user_id, amount, reason)
      select user_id, stake, 'pool_refund' from public.pool_entries where pool_id = v_pool and user_id <> v_me;
    update public.pools set status = 'voided' where id = v_pool;
  end loop;
  delete from auth.users where id = v_me;
end $$;

grant execute on function public.block_user(uuid), public.unblock_user(uuid), public.my_blocks(),
  public.report_content(uuid, uuid, text), public.delete_my_account(),
  public.my_pools(), public.search_people(text), public.send_friend_request(text)
to authenticated;
-- is_blocked_between is not granted: it's only used inside the functions above.

-- 6. Advisor fix: functions from 0009 were callable while signed out. Signed-in only.
revoke execute on function public.create_pool(uuid, text, bigint, jsonb, uuid), public.my_social(), public.my_pools(),
  public.cancel_friend_request(uuid), public.search_people(text),
  public.block_user(uuid), public.unblock_user(uuid), public.my_blocks(),
  public.report_content(uuid, uuid, text), public.delete_my_account(), public.is_blocked_between(uuid, uuid)
from public, anon;
