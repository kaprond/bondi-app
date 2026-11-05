-- Daily missions. Mirrors src/missions.ts. Each mission pays once a day, after the server
-- re-checks it against today's bets. Coins stay free-to-play: no cash value, no cash-out.

alter type ledger_reason add value if not exists 'mission';

create table public.mission_claims (
  user_id    uuid not null references public.profiles on delete cascade,
  mission    text not null check (mission in ('calls3', 'run2', 'underdog', 'share')),
  day        date not null default current_date,
  reward     bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission, day)
);
alter table public.mission_claims enable row level security;
create policy own_mission_claims on public.mission_claims for select using (user_id = auth.uid());

create or replace function public.claim_mission(p_mission text)
returns table (balance bigint, reward bigint)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_ok boolean; v_reward bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  v_reward := case p_mission when 'calls3' then 150 when 'run2' then 200 when 'underdog' then 250 when 'share' then 100 end;
  if v_reward is null then raise exception 'unknown mission'; end if;

  v_ok := case p_mission
    when 'calls3' then (select count(*) >= 3 from public.bets where user_id = v_user and created_at::date = current_date)
    when 'run2' then exists (
      select 1 from (
        select won, lag(won) over (order by created_at) as prev_won
        from public.bets where user_id = v_user and created_at::date = current_date
      ) x where x.won and x.prev_won)
    when 'underdog' then exists (
      select 1 from public.bets b join public.clips c on c.id = b.clip_id
      where b.user_id = v_user and b.created_at::date = current_date and b.won
        and b.odds > (case b.choice when 'a' then c.odds_b else c.odds_a end))
    when 'share' then true  -- can't be verified server-side; capped at once a day like the rest
  end;
  if not v_ok then raise exception 'mission not finished yet'; end if;

  insert into public.mission_claims (user_id, mission, reward) values (v_user, p_mission, v_reward)
    on conflict do nothing;
  if found then
    insert into public.ledger (user_id, amount, reason) values (v_user, v_reward, 'mission');
  else
    v_reward := 0;
  end if;
  return query select (select coalesce(sum(amount), 0) from public.ledger where user_id = v_user)::bigint, v_reward;
end $$;

grant execute on function public.claim_mission(text) to authenticated;
