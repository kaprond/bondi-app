-- Daily reward with a day streak. Mirrors dailyAmount() in src/api.ts:
-- 500 coins on day 1, +100 for each day in a row, capped at 1,000 from day 6. Miss a day and it resets.
-- Coins stay free-to-play: no cash value, can't be bought or cashed out.

alter table public.profiles add column if not exists daily_streak int not null default 0;

create or replace function public.daily_amount(p_streak int) returns bigint
language sql immutable as $$ select (500 + 100 * (least(greatest(p_streak, 1), 6) - 1))::bigint $$;

create or replace function public.daily_status()
returns table (claimed boolean, day_streak int, amount bigint)
language sql stable security definer set search_path = public as $$
  select p.last_daily_grant = current_date,
         case when p.last_daily_grant = current_date then p.daily_streak
              when p.last_daily_grant = current_date - 1 then p.daily_streak + 1
              else 1 end,
         public.daily_amount(case when p.last_daily_grant = current_date then p.daily_streak
              when p.last_daily_grant = current_date - 1 then p.daily_streak + 1 else 1 end)
  from public.profiles p where p.id = auth.uid()
$$;

-- Replaces 0001's claim_daily(): now returns the amount and the streak as well as the balance.
drop function if exists public.claim_daily();
create function public.claim_daily()
returns table (balance bigint, amount bigint, day_streak int)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_streak int; v_amount bigint := 0;
begin
  update public.profiles
     set daily_streak = case when last_daily_grant = current_date - 1 then daily_streak + 1 else 1 end,
         last_daily_grant = current_date
   where id = v_user and (last_daily_grant is null or last_daily_grant < current_date)
  returning daily_streak into v_streak;
  if found then
    v_amount := public.daily_amount(v_streak);
    insert into public.ledger (user_id, amount, reason) values (v_user, v_amount, 'daily_grant');
  else
    select p.daily_streak into v_streak from public.profiles p where p.id = v_user;
  end if;
  return query select (select coalesce(sum(l.amount), 0) from public.ledger l where l.user_id = v_user)::bigint, v_amount, v_streak;
end $$;

grant execute on function public.daily_status(), public.claim_daily() to authenticated;
