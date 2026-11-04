-- Bondi free-to-play MVP: core schema
-- Coins have no cash value and can never be withdrawn.

create extension if not exists pgcrypto;

-- Players ------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique,
  created_at    timestamptz not null default now(),
  last_daily_grant date
);

-- Clips --------------------------------------------------------------------
-- outcome, salt and reveal_asset_id are never readable by players (see view below).
create type clip_status as enum ('draft', 'committed', 'live', 'retired');
create type clip_side   as enum ('a', 'b');

create table public.clips (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  creator          text not null default '@bondi.originals',
  question         text not null default 'What happens next?',
  label_a          text not null,              -- e.g. 'He lands the trick'
  label_b          text not null,              -- e.g. 'He bails'
  odds_a           numeric(5,2) not null check (odds_a > 1),
  odds_b           numeric(5,2) not null check (odds_b > 1),
  teaser_asset_id  text not null,              -- video up to the pause point
  reveal_asset_id  text not null,              -- continuation, signed URL only after a bet
  outcome          clip_side,
  salt             text,
  commit_hash      text,                       -- sha256(id|outcome|salt), published at commit
  status           clip_status not null default 'draft',
  reviewed_by      uuid[] not null default '{}',-- two-person outcome review
  plays            integer not null default 0,
  picks_a          integer not null default 0,
  picks_b          integer not null default 0,
  wins_a           integer not null default 0,
  wins_b           integer not null default 0,
  created_at       timestamptz not null default now(),
  committed_at     timestamptz,
  constraint outcome_set_when_committed check (status = 'draft' or (outcome is not null and commit_hash is not null))
);

-- Public, safe projection of live clips
create view public.feed_clips with (security_invoker = false) as
  select id, title, creator, question, label_a, label_b, odds_a, odds_b, teaser_asset_id, commit_hash,
         coalesce(round(100.0 * picks_a / nullif(picks_a + picks_b, 0)), 50)::int as crowd_a
  from public.clips where status = 'live';

-- Which clips a player has already seen (never serve twice)
create table public.clip_views (
  user_id  uuid references public.profiles on delete cascade,
  clip_id  uuid references public.clips on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (user_id, clip_id)
);

-- Coin ledger (append-only; balance = sum) ---------------------------------
create type ledger_reason as enum ('daily_grant', 'signup_grant', 'bet_stake', 'bet_payout', 'adjustment');

create table public.ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles on delete cascade,
  amount      bigint not null,                 -- in coins, signed
  reason      ledger_reason not null,
  bet_id      uuid,
  created_at  timestamptz not null default now()
);
create index on public.ledger (user_id);

create view public.balances as
  select user_id, coalesce(sum(amount), 0)::bigint as coins from public.ledger group by user_id;

-- Bets ---------------------------------------------------------------------
create table public.bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  clip_id     uuid not null references public.clips,
  choice      clip_side not null,
  stake       bigint not null check (stake in (10, 20, 50, 100)),
  odds        numeric(5,2) not null,            -- odds shown at bet time
  won         boolean not null,
  payout      bigint not null,                  -- total returned (0 if lost)
  created_at  timestamptz not null default now(),
  unique (user_id, clip_id)
);

-- Atomic place-and-settle. Outcome is only returned after the stake is debited.
create or replace function public.place_bet(p_clip uuid, p_choice clip_side, p_stake bigint)
returns table (bet_id uuid, won boolean, payout bigint, outcome clip_side, salt text, balance bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_clip public.clips;
  v_bal  bigint;
  v_odds numeric(5,2);
  v_won  boolean;
  v_pay  bigint;
  v_bet  uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_clip from public.clips where id = p_clip and status = 'live' for update;
  if not found then raise exception 'clip not available'; end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select coalesce(sum(amount),0) into v_bal from public.ledger where user_id = v_user;
  if v_bal < p_stake then raise exception 'insufficient coins'; end if;

  v_odds := case p_choice when 'a' then v_clip.odds_a else v_clip.odds_b end;
  v_won  := (p_choice = v_clip.outcome);
  v_pay  := case when v_won then floor(p_stake * v_odds)::bigint else 0 end;

  insert into public.bets (user_id, clip_id, choice, stake, odds, won, payout)
    values (v_user, p_clip, p_choice, p_stake, v_odds, v_won, v_pay) returning id into v_bet;

  insert into public.ledger (user_id, amount, reason, bet_id) values (v_user, -p_stake, 'bet_stake', v_bet);
  if v_pay > 0 then
    insert into public.ledger (user_id, amount, reason, bet_id) values (v_user, v_pay, 'bet_payout', v_bet);
  end if;

  update public.clips set plays = plays + 1,
    picks_a = picks_a + (case when p_choice = 'a' then 1 else 0 end),
    picks_b = picks_b + (case when p_choice = 'b' then 1 else 0 end),
    wins_a = wins_a + (case when p_choice = 'a' and v_won then 1 else 0 end),
    wins_b = wins_b + (case when p_choice = 'b' and v_won then 1 else 0 end)
    where id = p_clip;

  insert into public.clip_views (user_id, clip_id) values (v_user, p_clip) on conflict do nothing;

  return query select v_bet, v_won, v_pay, v_clip.outcome, v_clip.salt,
    (select coalesce(sum(amount),0)::bigint from public.ledger where user_id = v_user);
end $$;

-- Daily free coins (no purchase in MVP)
create or replace function public.claim_daily()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  update public.profiles set last_daily_grant = current_date
    where id = v_user and (last_daily_grant is null or last_daily_grant < current_date);
  if found then
    insert into public.ledger (user_id, amount, reason) values (v_user, 500, 'daily_grant');
  end if;
  return (select coalesce(sum(amount),0) from public.ledger where user_id = v_user);
end $$;

-- RLS ----------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.clips      enable row level security;   -- no player policies: admin/service role only
alter table public.clip_views enable row level security;
alter table public.ledger     enable row level security;
alter table public.bets       enable row level security;

create policy own_profile on public.profiles for select using (id = auth.uid());
create policy own_views   on public.clip_views for select using (user_id = auth.uid());
create policy own_ledger  on public.ledger for select using (user_id = auth.uid());
create policy own_bets    on public.bets   for select using (user_id = auth.uid());

grant select on public.feed_clips to authenticated;
grant execute on function public.place_bet(uuid, clip_side, bigint) to authenticated;
grant execute on function public.claim_daily() to authenticated;
