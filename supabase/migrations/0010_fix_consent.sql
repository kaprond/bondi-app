-- consent_as_subject from 0002 never worked: the CASE returned text, not pool_status.
create or replace function public.consent_as_subject(p_pool uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pools
     set subject_consented = p_accept, status = (case when p_accept then 'open' else 'rejected' end)::pool_status
   where id = p_pool and subject_user_id = auth.uid() and status = 'pending_consent';
  if not found then raise exception 'nothing to consent to'; end if;
end $$;
