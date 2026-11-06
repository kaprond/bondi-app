-- Creator clips: players upload their own clips and earn coins every time someone calls them.
-- Mirrors src/creator.ts. Coins stay free-to-play: no cash value, no cash-out.
--
-- Integrity rules, because the uploader knows the outcome:
--   1. The creator declares the outcome at upload. It is committed (sha256 of id|outcome|salt)
--      at that moment, before anyone reviews or plays it, and can never be edited afterwards.
--   2. A reviewer watches the full video and approves only if the declared outcome is what
--      happens. A wrong declaration is a rejection, never a correction.
--   3. The creator can't see or call their own clip (feed_clips filters it, place_bet refuses it).
--   4. Commission is paid by the house on every call, win or lose, so the creator earns from
--      plays, not from players losing. It is capped per day so alt accounts can't farm it.
--
-- For real money later: creator_earnings is already a per-bet statement. Payouts would need
-- creator KYC, a payout provider, and blocking calls from accounts linked to the creator.

alter type clip_status   add value if not exists 'in_review';
alter type clip_status   add value if not exists 'rejected';
alter type ledger_reason add value if not exists 'creator_commission';

alter table public.clips
  add column creator_id       uuid references public.profiles on delete set null, -- null = Bondi originals
  add column source_path      text,          -- creator-uploads/<uid>/<file>, full video, never public
  add column pause_at         numeric(6,2),  -- seconds; the pipeline cuts teaser/reveal here
  add column duration         numeric(6,2),
  add column rights_confirmed_at timestamptz,
  add column rejection_reason text;
create index on public.clips (creator_id);

-- Creator clips get their teaser/reveal from the cutting pipeline after review.
alter table public.clips alter column teaser_asset_id drop not null;
alter table public.clips alter column reveal_asset_id drop not null;
alter table public.clips add constraint live_has_assets
  check (status::text <> 'live' or (teaser_asset_id is not null and reveal_asset_id is not null));

-- Per-bet commission statement. One row per bet at most.
create table public.creator_earnings (
  id          bigint generated always as identity primary key,
  creator_id  uuid not null references public.profiles on delete cascade,
  clip_id     uuid not null references public.clips on delete cascade,
  bet_id      uuid not null unique references public.bets on delete cascade,
  stake       bigint not null,
  amount      bigint not null check (amount >= 0),
  created_at  timestamptz not null default now()
);
create index on public.creator_earnings (creator_id, created_at);
alter table public.creator_earnings enable row level security;
create policy own_earnings on public.creator_earnings for select using (creator_id = auth.uid());

-- The feed never shows you your own clips.
create or replace view public.feed_clips with (security_invoker = false) as
  select id, title, creator, question, label_a, label_b, odds_a, odds_b, teaser_asset_id, commit_hash,
         coalesce(round(100.0 * picks_a / nullif(picks_a + picks_b, 0)), 50)::int as crowd_a
  from public.clips
  where status = 'live' and creator_id is distinct from auth.uid();

-- Your uploads with plays and earnings. No salt, no asset ids.
create view public.my_clips with (security_invoker = false) as
  select c.id, c.title, c.question, c.label_a, c.label_b, c.outcome, c.pause_at, c.duration,
         c.status::text as status, c.rejection_reason, c.created_at, c.committed_at, c.plays,
         coalesce(e.staked, 0)::bigint as staked, coalesce(e.earned, 0)::bigint as earned
  from public.clips c
  left join (select clip_id, sum(stake) as staked, sum(amount) as earned from public.creator_earnings group by clip_id) e
    on e.clip_id = c.id
  where c.creator_id = auth.uid();
grant select on public.my_clips to authenticated;

-- Upload ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('creator-uploads', 'creator-uploads', false, 104857600, array['video/mp4', 'video/quicktime', 'video/webm'])
  on conflict (id) do nothing;

-- You can upload into your own folder only. Nobody but the service role can read it back.
create policy creator_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'creator-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.submit_clip(
  p_title text, p_question text, p_label_a text, p_label_b text, p_outcome clip_side,
  p_pause_at numeric, p_duration numeric, p_source_path text, p_rights boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_handle text; v_id uuid := gen_random_uuid(); v_salt text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not coalesce(p_rights, false) then raise exception 'confirm the clip is yours and everyone in it agreed'; end if;
  if p_outcome is null then raise exception 'declare which answer really happens'; end if;
  if length(trim(p_title)) not between 3 and 60 or length(trim(p_question)) not between 5 and 60
     or length(trim(p_label_a)) not between 1 and 60 or length(trim(p_label_b)) not between 1 and 60
     or lower(trim(p_label_a)) = lower(trim(p_label_b)) then raise exception 'check the title, question and answers'; end if;
  if p_duration is null or p_duration > 60.5 or p_pause_at < 2 or p_duration - p_pause_at < 1 then
    raise exception 'pause point must leave a setup and a reveal, max 60 seconds'; end if;
  if split_part(p_source_path, '/', 1) <> v_user::text then raise exception 'bad upload path'; end if;
  if (select count(*) from public.clips where creator_id = v_user and status::text = 'in_review') >= 3 then
    raise exception 'you have 3 clips waiting for review already'; end if;

  select handle into v_handle from public.profiles where id = v_user;
  v_salt := 'bnd-' || encode(gen_random_bytes(6), 'hex');
  insert into public.clips (id, title, creator, question, label_a, label_b, odds_a, odds_b,
      outcome, salt, commit_hash, status, creator_id, source_path, pause_at, duration, rights_confirmed_at, committed_at)
    values (v_id, trim(p_title), '@' || coalesce(v_handle, 'player'), trim(p_question), trim(p_label_a), trim(p_label_b), 1.90, 1.90,
      p_outcome, v_salt, encode(digest(v_id::text || '|' || p_outcome::text || '|' || v_salt, 'sha256'), 'hex'),
      'in_review', v_user, p_source_path, p_pause_at, p_duration, now(), now());
  return v_id;
end $$;
grant execute on function public.submit_clip(text, text, text, text, clip_side, numeric, numeric, text, boolean) to authenticated;

-- Review (service role / admin tool only, not granted to players) ------------
-- Approve only when the declared outcome is what happens in the video, after the pipeline has
-- cut teaser and reveal at pause_at. The creator can't review their own clip.
create or replace function public.review_clip(p_clip uuid, p_reviewer uuid, p_approve boolean,
  p_reason text default null, p_teaser text default null, p_reveal text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_clip public.clips;
begin
  select * into v_clip from public.clips where id = p_clip and status::text = 'in_review' for update;
  if not found then raise exception 'clip is not waiting for review'; end if;
  if v_clip.creator_id = p_reviewer then raise exception 'creators cannot review their own clips'; end if;
  if p_approve then
    if p_teaser is null or p_reveal is null then raise exception 'cut teaser and reveal first'; end if;
    update public.clips set status = 'live', teaser_asset_id = p_teaser, reveal_asset_id = p_reveal,
      reviewed_by = array_append(reviewed_by, p_reviewer) where id = p_clip;
  else
    update public.clips set status = 'rejected', rejection_reason = coalesce(p_reason, 'didn’t pass review'),
      reviewed_by = array_append(reviewed_by, p_reviewer) where id = p_clip;
  end if;
end $$;
revoke execute on function public.review_clip(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;

-- Betting: refuse your own clip, pay the creator ------------------------------
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
  v_fee  bigint;
  v_today bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_clip from public.clips where id = p_clip and status = 'live' for update;
  if not found then raise exception 'clip not available'; end if;
  if v_clip.creator_id = v_user then raise exception 'you can’t call your own clip'; end if;

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

  -- Creator commission: 5% of the stake, at least 1 coin, paid by the house, capped at 2,000 a day.
  if v_clip.creator_id is not null then
    perform pg_advisory_xact_lock(hashtext('commission:' || v_clip.creator_id::text));
    select coalesce(sum(amount), 0) into v_today from public.creator_earnings
      where creator_id = v_clip.creator_id and created_at >= date_trunc('day', now());
    v_fee := least(greatest(1, floor(p_stake * 0.05))::bigint, greatest(0, 2000 - v_today));
    insert into public.creator_earnings (creator_id, clip_id, bet_id, stake, amount)
      values (v_clip.creator_id, p_clip, v_bet, p_stake, v_fee);
    if v_fee > 0 then
      insert into public.ledger (user_id, amount, reason, bet_id) values (v_clip.creator_id, v_fee, 'creator_commission', v_bet);
    end if;
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
