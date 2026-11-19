-- Share a pool to a group chat. The link (https://…/p/<pool>?i=<invite code>) shows a preview card
-- with the question, and whoever opens it lands in the app and joins that pool's crew.

-- Public preview for the link card: only the question, crew name, pot and who started it,
-- and only while the pool is still in play. Callable without signing in (link previews do that).
create or replace function public.pool_preview(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question', p.question,
    'crew', g.name,
    'pot', (select count(*) from public.pool_entries e where e.pool_id = p.id) * p.stake,
    'stake', p.stake,
    'by', (select handle from public.profiles where id = p.created_by),
    'status', p.status)
  from public.pools p join public.groups g on g.id = p.group_id
  where p.id = p_pool and p.status in ('pending_consent', 'open', 'proposed')
$$;

-- Join the crew behind a shared pool. The invite code must belong to someone in that crew,
-- so a link only works when a member shared it. You also become friends with them.
create or replace function public.join_pool_link(p_pool uuid, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid; v_group uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select owner into v_owner from public.invite_codes where code = upper(trim(p_code));
  select group_id into v_group from public.pools where id = p_pool and status in ('pending_consent', 'open', 'proposed');
  if v_owner is null or v_group is null then raise exception 'this pool link has expired'; end if;
  if not exists (select 1 from public.group_members where group_id = v_group and user_id = v_owner) then
    raise exception 'this pool link has expired'; end if;
  if v_owner <> v_me and public.is_blocked_between(v_me, v_owner) then raise exception 'this pool link has expired'; end if;
  insert into public.group_members (group_id, user_id) values (v_group, v_me) on conflict do nothing;
  if v_owner <> v_me and not exists (select 1 from public.friendships
      where (requester = v_me and addressee = v_owner) or (requester = v_owner and addressee = v_me)) then
    insert into public.friendships (requester, addressee, status, accepted_at) values (v_owner, v_me, 'accepted', now());
  end if;
  return p_pool;
end $$;

grant execute on function public.pool_preview(uuid) to anon, authenticated;
grant execute on function public.join_pool_link(uuid, text) to authenticated;
revoke execute on function public.join_pool_link(uuid, text) from public, anon;
