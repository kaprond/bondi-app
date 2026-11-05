-- Profiles, friends, invite codes and crews.
-- Mirrors src/social.ts. Crews reuse public.groups / public.group_members from 0002.

alter table public.profiles
  add column if not exists display_name text check (char_length(display_name) <= 20),
  add column if not exists bio          text check (char_length(bio) <= 80),
  add column if not exists city         text check (char_length(city) <= 24),
  add column if not exists avatar_emoji text not null default '😎',
  add column if not exists avatar_color text not null default '#0095B6' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint handle_format check (handle is null or handle ~ '^[a-z0-9._]{3,20}$');

alter table public.groups add column if not exists emoji text not null default '🎉';

alter type ledger_reason add value if not exists 'referral_bonus';

-- Friendships ----------------------------------------------------------------
create type friend_status as enum ('pending', 'accepted');

create table public.friendships (
  requester  uuid not null references public.profiles on delete cascade,
  addressee  uuid not null references public.profiles on delete cascade,
  status     friend_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- one row per pair, whichever direction
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a)))
$$;

-- Public profile fields of anyone; stats are aggregated, never individual bets.
create view public.public_profiles with (security_invoker = false) as
  select p.id, p.handle, p.display_name, p.bio, p.city, p.avatar_emoji, p.avatar_color,
         count(b.id)::int as calls,
         coalesce(round(100.0 * count(b.id) filter (where b.won) / nullif(count(b.id), 0)), 0)::int as hit_rate
  from public.profiles p left join public.bets b on b.user_id = p.id
  group by p.id;
grant select on public.public_profiles to authenticated;

create or replace function public.send_friend_request(p_handle text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_them uuid; v_reverse public.friendships;
begin
  select id into v_them from public.profiles where handle = lower(trim(leading '@' from p_handle));
  if v_them is null then raise exception 'no one with that handle'; end if;
  if v_them = v_me then raise exception 'that is you'; end if;
  -- they already asked us: accept instead
  select * into v_reverse from public.friendships where requester = v_them and addressee = v_me;
  if found then
    update public.friendships set status = 'accepted', accepted_at = now() where requester = v_them and addressee = v_me;
    return;
  end if;
  insert into public.friendships (requester, addressee) values (v_me, v_them) on conflict do nothing;
end $$;

create or replace function public.respond_friend_request(p_from uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where requester = p_from and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships where requester = p_from and addressee = auth.uid() and status = 'pending';
  end if;
  if not found then raise exception 'no request from them'; end if;
end $$;

create or replace function public.remove_friend(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.friendships
   where (requester = auth.uid() and addressee = p_other) or (requester = p_other and addressee = auth.uid());
end $$;

-- Invites --------------------------------------------------------------------
create table public.invite_codes (
  code       text primary key check (code ~ '^BND-[A-Z0-9]{4}$'),
  owner      uuid not null unique references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table public.invite_redemptions (
  code        text not null references public.invite_codes on delete cascade,
  new_user    uuid primary key references public.profiles on delete cascade,  -- one redemption per new account
  redeemed_at timestamptz not null default now()
);

-- A new player redeems a code: both become friends and both get 500 coins (no cash value).
-- Only accounts younger than 7 days can redeem, and the bonus is capped at 20 referrals per owner.
create or replace function public.redeem_invite(p_code text)
returns void language plpgsql security definer set search_path = public as $$
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
  insert into public.ledger (user_id, amount, reason) values (v_me, 500, 'referral_bonus');
  if v_n <= 20 then
    insert into public.ledger (user_id, amount, reason) values (v_owner, 500, 'referral_bonus');
  end if;
end $$;

-- Crews ----------------------------------------------------------------------
-- Only friends of the creator can be added.
create or replace function public.create_crew(p_name text, p_emoji text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; m uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  foreach m in array p_members loop
    if not public.are_friends(v_me, m) then raise exception 'you can only add friends to a crew'; end if;
  end loop;
  insert into public.groups (name, emoji, created_by) values (lower(trim(p_name)), p_emoji, v_me) returning id into v_id;
  insert into public.group_members (group_id, user_id) select v_id, unnest(array_append(p_members, v_me));
  return v_id;
end $$;

create or replace function public.add_to_crew(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_group) then raise exception 'not your crew'; end if;
  if not public.are_friends(auth.uid(), p_user) then raise exception 'you can only add friends to a crew'; end if;
  insert into public.group_members (group_id, user_id) values (p_group, p_user) on conflict do nothing;
end $$;

-- RLS ------------------------------------------------------------------------
alter table public.friendships        enable row level security;
alter table public.invite_codes       enable row level security;
alter table public.invite_redemptions enable row level security;

create policy own_friendships on public.friendships for select using (auth.uid() in (requester, addressee));
create policy own_invite      on public.invite_codes for select using (owner = auth.uid());
create policy own_profile_upd on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

grant execute on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.redeem_invite(text), public.create_crew(text, text, uuid[]),
  public.add_to_crew(uuid, uuid) to authenticated;

-- Give every profile an invite code on creation (extends 0003's trigger).
create or replace function public.ensure_invite_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  loop
    v_code := 'BND-' || upper(substr(encode(gen_random_bytes(4), 'base64'), 1, 4));
    exit when v_code ~ '^BND-[A-Z0-9]{4}$' and not exists (select 1 from public.invite_codes where code = v_code);
  end loop;
  insert into public.invite_codes (code, owner) values (v_code, new.id);
  return new;
end $$;
create trigger profiles_invite_code after insert on public.profiles for each row execute function public.ensure_invite_code();
