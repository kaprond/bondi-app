-- Friend pools, coins only. Coins never cash out.

alter type ledger_reason add value if not exists 'pool_stake';
alter type ledger_reason add value if not exists 'pool_payout';
alter type ledger_reason add value if not exists 'pool_refund';

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references public.profiles,
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid references public.groups on delete cascade,
  user_id   uuid references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create type pool_status as enum ('pending_consent', 'open', 'locked', 'proposed', 'resolved', 'voided', 'rejected');

create table public.pools (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups on delete cascade,
  created_by        uuid not null references public.profiles,
  question          text not null check (char_length(question) <= 100),
  stake             bigint not null check (stake between 10 and 1000),  -- coins per entry
  subject_user_id   uuid references public.profiles,     -- must be a group member
  subject_consented boolean not null default false,
  moderation_flags  text[] not null default '{}',        -- set by the classifier at creation
  status            pool_status not null default 'pending_consent',
  closes_at         timestamptz,                          -- no new entries after this
  proposed_option   uuid,
  proposed_at       timestamptz,
  resolved_option   uuid,
  created_at        timestamptz not null default now()
);

create table public.pool_options (
  id              uuid primary key default gen_random_uuid(),
  pool_id         uuid not null references public.pools on delete cascade,
  label           text not null,
  member_user_id  uuid references public.profiles   -- "pick a winner" options naming a member
);

create table public.pool_entries (
  pool_id    uuid references public.pools on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  option_id  uuid not null references public.pool_options,
  stake      bigint not null,
  created_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create table public.pool_votes (
  pool_id   uuid references public.pools on delete cascade,
  user_id   uuid references public.profiles on delete cascade,
  confirm   boolean not null,             -- true = agrees with proposed result
  voted_at  timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create table public.reports (
  id          bigint generated always as identity primary key,
  pool_id     uuid references public.pools on delete cascade,
  reporter    uuid references public.profiles,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- Join a pool (conflict rule: the subject and any member named in an option cannot stake)
create or replace function public.join_pool(p_pool uuid, p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_pool public.pools; v_bal bigint;
begin
  select * into v_pool from public.pools where id = p_pool for update;
  if v_pool.status <> 'open' or (v_pool.closes_at is not null and now() > v_pool.closes_at) then
    raise exception 'pool not open'; end if;
  if not exists (select 1 from public.group_members where group_id = v_pool.group_id and user_id = v_user) then
    raise exception 'not a group member'; end if;
  if v_user = v_pool.subject_user_id
     or exists (select 1 from public.pool_options where pool_id = p_pool and member_user_id = v_user) then
    raise exception 'you control this outcome and cannot stake on it'; end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select coalesce(sum(amount),0) into v_bal from public.ledger where user_id = v_user;
  if v_bal < v_pool.stake then raise exception 'insufficient coins'; end if;

  insert into public.pool_entries (pool_id, user_id, option_id, stake) values (p_pool, v_user, p_option, v_pool.stake);
  insert into public.ledger (user_id, amount, reason) values (v_user, -v_pool.stake, 'pool_stake');
end $$;

-- Creator proposes the result; participants then have 48h to confirm or dispute
create or replace function public.propose_result(p_pool uuid, p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pools set status = 'proposed', proposed_option = p_option, proposed_at = now()
   where id = p_pool and created_by = auth.uid() and status in ('open', 'locked');
  if not found then raise exception 'cannot propose'; end if;
end $$;

create or replace function public.vote_result(p_pool uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.pool_entries where pool_id = p_pool and user_id = auth.uid()) then
    raise exception 'only participants vote'; end if;
  insert into public.pool_votes (pool_id, user_id, confirm) values (p_pool, auth.uid(), p_confirm)
    on conflict (pool_id, user_id) do update set confirm = excluded.confirm, voted_at = now();
end $$;

-- Run by a scheduled job (service role). Majority of participants must confirm; otherwise void + refund.
create or replace function public.finalize_pool(p_pool uuid)
returns pool_status language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_n int; v_yes int; v_no int; v_pot bigint; v_winners int;
begin
  select * into v_pool from public.pools where id = p_pool for update;
  if v_pool.status <> 'proposed' or now() < v_pool.proposed_at + interval '48 hours' then
    return v_pool.status; end if;

  select count(*), coalesce(sum(stake),0) into v_n, v_pot from public.pool_entries where pool_id = p_pool;
  select count(*) filter (where confirm), count(*) filter (where not confirm) into v_yes, v_no
    from public.pool_votes where pool_id = p_pool;
  select count(*) into v_winners from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option;

  if v_yes * 2 > v_n and v_winners > 0 then
    insert into public.ledger (user_id, amount, reason)
      select user_id, floor(v_pot::numeric / v_winners)::bigint, 'pool_payout'
      from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option;
    update public.pools set status = 'resolved', resolved_option = v_pool.proposed_option where id = p_pool;
    return 'resolved';
  else
    insert into public.ledger (user_id, amount, reason)
      select user_id, stake, 'pool_refund' from public.pool_entries where pool_id = p_pool;
    update public.pools set status = 'voided' where id = p_pool;
    return 'voided';
  end if;
end $$;

-- Subject must accept before the pool opens
create or replace function public.consent_as_subject(p_pool uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pools
     set subject_consented = p_accept, status = case when p_accept then 'open' else 'rejected' end
   where id = p_pool and subject_user_id = auth.uid() and status = 'pending_consent';
  if not found then raise exception 'nothing to consent to'; end if;
end $$;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.pools         enable row level security;
alter table public.pool_options  enable row level security;
alter table public.pool_entries  enable row level security;
alter table public.pool_votes    enable row level security;
alter table public.reports       enable row level security;

create or replace function public.is_member(g uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid()) $$;

create policy member_groups  on public.groups        for select using (public.is_member(id));
create policy member_list    on public.group_members for select using (public.is_member(group_id));
create policy member_pools   on public.pools         for select using (public.is_member(group_id));
create policy member_options on public.pool_options  for select using (exists (select 1 from public.pools p where p.id = pool_id and public.is_member(p.group_id)));
create policy member_entries on public.pool_entries  for select using (exists (select 1 from public.pools p where p.id = pool_id and public.is_member(p.group_id)));
create policy member_votes   on public.pool_votes    for select using (exists (select 1 from public.pools p where p.id = pool_id and public.is_member(p.group_id)));
create policy file_report    on public.reports       for insert with check (reporter = auth.uid());

-- Pool creation goes through an Edge Function (create-pool) that runs the topic classifier
-- (blocked: intoxication/health, injury/danger, sex/dating of non-members, minors, crime, self-harm, appearance)
-- before inserting with the service role.
