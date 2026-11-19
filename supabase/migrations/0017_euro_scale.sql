-- Deflate coins to a friendly "1 coin ≈ €1" scale (still play money: free, not buyable, not cashable).
--   signup 1000 → 50 · daily 500..1000 → 5..10 · invite 500 → 10 each · missions → 2..5
--   pool stakes 1/2/5/10 · clip stakes 1/2/5/10 · creator commission 10% (no minimum), cap 20/day
-- Existing balances are divided by 20 with one 'adjustment' ledger row per player.

-- 1. Grants ---------------------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.ledger (user_id, amount, reason) values (new.id, 50, 'signup_grant');
  return new;
end $$;

create or replace function public.daily_amount(p_streak integer) returns bigint
language sql immutable set search_path = public as $$
  select (5 + (least(greatest(p_streak, 1), 6) - 1))::bigint
$$;

create or replace function public.claim_daily_v1() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  update public.profiles set last_daily_grant = current_date
    where id = v_user and (last_daily_grant is null or last_daily_grant < current_date);
  if found then
    insert into public.ledger (user_id, amount, reason) values (v_user, 5, 'daily_grant');
  end if;
  return (select coalesce(sum(amount),0) from public.ledger where user_id = v_user);
end $$;

-- 2. Invites: 10 each (inviter capped at 20 redemptions, as before) -------------------------------
create or replace function public.redeem_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid; v_n int;
begin
  select owner into v_owner from public.invite_codes where code = upper(p_code);
  if v_owner is null then raise exception 'invite code not found'; end if;
  if v_owner = v_me then raise exception 'that is your own code'; end if;
  if (select created_at from auth.users where id = v_me) < now() - interval '7 days' then
    raise exception 'invite codes are for new players'; end if;
  insert into public.invite_redemptions (code, new_user) values (upper(p_code), v_me);
  insert into public.friendships (requester, addressee, status, accepted_at) values (v_owner, v_me, 'accepted', now())
    on conflict do nothing;
  select count(*) into v_n from public.invite_redemptions where code = upper(p_code);
  insert into public.ledger (user_id, amount, reason) values (v_me, 10, 'referral_bonus');
  if v_n <= 20 then
    insert into public.ledger (user_id, amount, reason) values (v_owner, 10, 'referral_bonus');
  end if;
end $$;

-- 3. Missions ---------------------------------------------------------------------------------------
do $m$
declare v_src text;
begin
  select pg_get_functiondef('public.claim_mission(text)'::regprocedure) into v_src;
  v_src := replace(v_src, $r$when 'calls3' then 150 when 'run2' then 200 when 'underdog' then 250 when 'share' then 100 end$r$,
                          $r$when 'calls3' then 3 when 'run2' then 4 when 'underdog' then 5 when 'share' then 2 end$r$);
  if v_src not like '%then 3 when ''run2'' then 4%' then raise exception 'claim_mission rewards not found'; end if;
  execute v_src;
end $m$;

-- 4. Clip calls: stakes 1/2/5/10, commission 10% with no minimum, 20/day cap -----------------------
do $b$
declare v_src text;
begin
  select pg_get_functiondef('public.place_bet(uuid, clip_side, bigint)'::regprocedure) into v_src;
  v_src := replace(v_src, 'v_fee := least(greatest(1, floor(p_stake * 0.05))::bigint, greatest(0, 2000 - v_today));',
                          'v_fee := least(floor(p_stake * 0.10)::bigint, greatest(0, 20 - v_today));');
  v_src := replace(v_src, $r$if v_bal < p_stake then raise exception 'insufficient coins'; end if;$r$,
                          $r$if p_stake not in (1, 2, 5, 10) then raise exception 'pick 1, 2, 5 or 10 coins'; end if;
  if v_bal < p_stake then raise exception 'insufficient coins'; end if;$r$);
  if v_src not like '%p_stake * 0.10%' or v_src not like '%pick 1, 2, 5 or 10%' then raise exception 'place_bet patch failed'; end if;
  execute v_src;
end $b$;

-- 5. Pools: stakes 1 to 50; the pot is split exactly (leftover coins go to the earliest right calls) --
alter table public.pools drop constraint if exists pools_stake_check;
alter table public.pools add constraint pools_stake_check check (stake between 1 and 50) not valid;
alter table public.bets drop constraint if exists bets_stake_check;
alter table public.bets add constraint bets_stake_check check (stake in (1, 2, 5, 10)) not valid;

create or replace function public.finalize_pool(p_pool uuid) returns pool_status
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools; v_n int; v_yes int; v_pot bigint; v_winners int;
begin
  select * into v_pool from public.pools where id = p_pool for update;
  if v_pool.status <> 'proposed' or now() < v_pool.proposed_at + interval '48 hours' then
    return v_pool.status; end if;

  select count(*), coalesce(sum(stake),0) into v_n, v_pot from public.pool_entries where pool_id = p_pool;
  select count(*) filter (where confirm) into v_yes from public.pool_votes where pool_id = p_pool;
  select count(*) into v_winners from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option;

  if v_yes * 2 > v_n and v_winners > 0 then
    insert into public.ledger (user_id, amount, reason)
      select user_id, v_pot / v_winners + case when rn <= v_pot % v_winners then 1 else 0 end, 'pool_payout'
      from (select user_id, row_number() over (order by created_at, user_id) rn
            from public.pool_entries where pool_id = p_pool and option_id = v_pool.proposed_option) w;
    update public.pools set status = 'resolved', resolved_option = v_pool.proposed_option where id = p_pool;
    return 'resolved';
  else
    insert into public.ledger (user_id, amount, reason)
      select user_id, stake, 'pool_refund' from public.pool_entries where pool_id = p_pool;
    update public.pools set status = 'voided' where id = p_pool;
    return 'voided';
  end if;
end $$;

-- Standings use the same exact split.
create or replace function public.crew_standings(p_group uuid, p_period text default 'month') returns jsonb
language sql stable security definer set search_path = public as $$
  with settled as (
    select p.id, p.resolved_option, coalesce(p.proposed_at, p.created_at) as at,
           (select sum(stake) from public.pool_entries where pool_id = p.id)::bigint as pot,
           (select count(*) from public.pool_entries where pool_id = p.id and option_id = p.resolved_option) as winners
    from public.pools p
    where p.group_id = p_group and p.status = 'resolved'
      and (p_period = 'all' or coalesce(p.proposed_at, p.created_at) >= date_trunc('month', now()))
  ), entries as (
    select e.*, s.at, s.pot, s.winners, (e.option_id = s.resolved_option) as won,
           row_number() over (partition by e.pool_id, (e.option_id = s.resolved_option) order by e.created_at, e.user_id) as rn
    from settled s join public.pool_entries e on e.pool_id = s.id
  ), plays as (
    select user_id, at, won,
           case when won then pot / winners + case when rn <= pot % winners then 1 else 0 end - stake else -stake end as net
    from entries
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

-- 6. Rescale existing balances ÷20 (rounded), once ---------------------------------------------------
insert into public.ledger (user_id, amount, reason)
select user_id, round(bal / 20.0)::bigint - bal, 'adjustment'
from (select user_id, sum(amount) bal from public.ledger group by user_id) b
where bal <> round(bal / 20.0)::bigint
  and not exists (select 1 from public.ledger l where l.user_id = b.user_id and l.reason = 'adjustment' and l.created_at > now() - interval '1 day');
