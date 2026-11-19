-- Push notifications through Expo's push service (https://exp.host), sent straight from the
-- database with pg_net. No secrets needed: Expo push tokens are the addressing.

create extension if not exists pg_net;

create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles on delete cascade,
  platform   text not null default 'ios',
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy own_tokens on public.push_tokens for select using (user_id = auth.uid());

-- Register this device for pushes (a token moves with whoever is signed in on the phone).
create or replace function public.register_push_token(p_token text, p_platform text default 'ios') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$' then raise exception 'bad push token'; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), left(coalesce(p_platform, 'ios'), 10))
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

-- Send one message to a set of users. Fire-and-forget: a failed push never blocks the game.
create or replace function public.push_to(p_users uuid[], p_title text, p_body text, p_data jsonb default '{}') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_msgs jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('to', t.token, 'title', p_title, 'body', p_body, 'data', p_data, 'sound', 'default')), '[]')
    into v_msgs from public.push_tokens t where t.user_id = any(p_users);
  if jsonb_array_length(v_msgs) = 0 then return; end if;
  perform net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := v_msgs,
                        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb);
exception when others then
  raise warning 'push_to failed: %', sqlerrm;
end $$;

create or replace function public.handle_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce('@' || handle, 'someone') from public.profiles where id = p_user
$$;

-- Friend requests and accepts
create or replace function public.push_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status::text = 'pending' then
    perform public.push_to(array[new.addressee], 'new friend request', public.handle_of(new.requester) || ' wants to be friends', jsonb_build_object('go', 'friends'));
  elsif tg_op = 'UPDATE' and new.status::text = 'accepted' and old.status::text <> 'accepted' then
    perform public.push_to(array[new.requester], 'you’re friends now', public.handle_of(new.addressee) || ' accepted your request', jsonb_build_object('go', 'friends'));
  end if;
  return null;
end $$;
drop trigger if exists push_friendship on public.friendships;
create trigger push_friendship after insert or update of status on public.friendships
  for each row execute function public.push_on_friendship();

-- Pools: new pool in your crew, someone joined yours, result up for a vote, settled
create or replace function public.push_on_pool() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_crew text; v_members uuid[]; v_in uuid[];
begin
  select g.name into v_crew from public.groups g where g.id = new.group_id;
  select array_agg(e.user_id) into v_in from public.pool_entries e where e.pool_id = new.id;
  if tg_op = 'INSERT' then
    if new.status::text = 'pending_consent' and new.subject_user_id is not null then
      perform public.push_to(array[new.subject_user_id], 'a pool about you', public.handle_of(new.created_by) || ' asks: ' || new.question || ' ok with it?', jsonb_build_object('go', 'pool', 'id', new.id));
    else
      select array_agg(m.user_id) into v_members from public.group_members m
       where m.group_id = new.group_id and m.user_id is distinct from new.created_by and m.user_id is distinct from new.subject_user_id;
      perform public.push_to(v_members, 'new pool in ' || coalesce(v_crew, 'your crew'), new.question, jsonb_build_object('go', 'pool', 'id', new.id));
    end if;
  elsif new.status is distinct from old.status then
    if new.status::text = 'open' and old.status::text = 'pending_consent' then
      select array_agg(m.user_id) into v_members from public.group_members m
       where m.group_id = new.group_id and m.user_id is distinct from new.subject_user_id;
      perform public.push_to(v_members, 'pool is open', new.question, jsonb_build_object('go', 'pool', 'id', new.id));
    elsif new.status::text = 'proposed' then
      perform public.push_to(array(select unnest(v_in) except select new.created_by), 'time to vote', 'a result was proposed for: ' || new.question, jsonb_build_object('go', 'pool', 'id', new.id));
    elsif new.status::text = 'resolved' then
      perform public.push_to(v_in, 'pool settled 🏆', new.question || ' — see who won', jsonb_build_object('go', 'pool', 'id', new.id));
    elsif new.status::text = 'voided' then
      perform public.push_to(v_in, 'pool cancelled', 'coins are back for: ' || new.question, jsonb_build_object('go', 'pool', 'id', new.id));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists push_pool on public.pools;
create trigger push_pool after insert or update of status on public.pools
  for each row execute function public.push_on_pool();

create or replace function public.push_on_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pool public.pools;
begin
  select * into v_pool from public.pools where id = new.pool_id;
  if v_pool.created_by is not null and v_pool.created_by <> new.user_id then
    perform public.push_to(array[v_pool.created_by], 'someone joined your pool', public.handle_of(new.user_id) || ' is in on: ' || v_pool.question, jsonb_build_object('go', 'pool', 'id', v_pool.id));
  end if;
  return null;
end $$;
drop trigger if exists push_entry on public.pool_entries;
create trigger push_entry after insert on public.pool_entries
  for each row execute function public.push_on_entry();

grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;
revoke execute on function public.register_push_token(text, text), public.unregister_push_token(text),
  public.push_to(uuid[], text, text, jsonb), public.handle_of(uuid) from public, anon;
revoke execute on function public.push_to(uuid[], text, text, jsonb), public.handle_of(uuid) from authenticated;
