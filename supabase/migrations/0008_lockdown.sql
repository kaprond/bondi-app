-- Lockdown before launch. Fixes from the Supabase security advisor and a manual review.

-- 1. Nobody signed out can call anything. Signed-in players only get the RPCs the app uses.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function
  public.place_bet(uuid, clip_side, bigint),
  public.claim_daily(), public.daily_status(), public.claim_mission(text),
  public.join_pool(uuid, uuid), public.propose_result(uuid, uuid), public.vote_result(uuid, boolean),
  public.consent_as_subject(uuid, boolean),
  public.send_friend_request(text), public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.redeem_invite(text), public.create_crew(text, text, uuid[]), public.add_to_crew(uuid, uuid),
  public.submit_clip(text, text, text, text, clip_side, numeric, numeric, text, boolean),
  public.is_member(uuid)   -- used inside RLS policies, so the caller needs it
to authenticated;
-- Not granted: handle_new_user, ensure_invite_code (triggers), finalize_pool (scheduled job),
-- review_clip (admin), are_friends (would expose anyone's friend graph), claim_daily_v1 (retired).

alter function public.daily_amount(int) set search_path = public;

-- 2. Views run as their owner, so they must be read-only and never reachable signed out.
--    Without this, feed_clips is auto-updatable and a player could edit live clips through it.
revoke all on public.feed_clips, public.my_clips, public.public_profiles, public.balances from public, anon, authenticated;
grant select on public.feed_clips, public.my_clips, public.public_profiles to authenticated;

-- balances: run as the caller, so the ledger's own-rows policy applies (you only see your balance).
alter view public.balances set (security_invoker = true);
grant select on public.balances to authenticated;

-- 3. Players can edit their profile fields, not their daily-coin date or streak (was free coins forever).
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (handle, display_name, bio, city, avatar_emoji, avatar_color) on public.profiles to authenticated;

-- 4. Nothing signed out reads or writes tables directly.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- 5. Pool options must belong to the pool you're staking on or resolving.
create or replace function public.join_pool(p_pool uuid, p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_pool public.pools; v_bal bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_pool from public.pools where id = p_pool for update;
  if not found or v_pool.status <> 'open' or (v_pool.closes_at is not null and now() > v_pool.closes_at) then
    raise exception 'pool not open'; end if;
  if not exists (select 1 from public.pool_options where id = p_option and pool_id = p_pool) then
    raise exception 'that option is not in this pool'; end if;
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

create or replace function public.propose_result(p_pool uuid, p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.pool_options where id = p_option and pool_id = p_pool) then
    raise exception 'that option is not in this pool'; end if;
  update public.pools set status = 'proposed', proposed_option = p_option, proposed_at = now()
   where id = p_pool and created_by = auth.uid() and status in ('open', 'locked');
  if not found then raise exception 'cannot propose'; end if;
end $$;
