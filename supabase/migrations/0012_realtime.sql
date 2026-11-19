-- Live updates: the app listens for changes on these tables instead of polling every 15s.
-- Row level security still applies, so you only hear about pools and requests you can see.
alter publication supabase_realtime add table public.pools, public.pool_entries, public.pool_votes,
  public.friendships, public.group_members;
