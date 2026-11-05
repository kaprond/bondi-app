-- Create a profile and a signup grant for every new auth user (including anonymous sign-ins)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.ledger (user_id, amount, reason) values (new.id, 1000, 'signup_grant');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

grant select on public.balances to authenticated;
