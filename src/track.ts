import { Platform } from 'react-native';
import { LIVE, rpc } from './backend';

/**
 * First-party funnel events (supabase/migrations/0015_engage.sql: events + track()).
 * No third-party SDK, no device ids, no ad tracking: just "this account did step X".
 * Fire-and-forget; a failed event never bothers the user.
 */
export type Event =
  | 'app_open' | 'welcome_done' | 'profile_done' | 'crew_created' | 'invite_shared' | 'crew_link_opened'
  | 'pool_created' | 'pool_joined' | 'pool_link_opened' | 'pool_shared' | 'comment_posted'
  | 'account_saved' | 'push_enabled' | 'first_run_skipped' | 'result_shared' | 'standings_viewed'
  | 'welcome_seen' | 'push_opened' | 'review_prompted';

export function track(name: Event, props: Record<string, string | number | boolean> = {}) {
  if (!LIVE) return;
  rpc('track', { p_name: name, p_props: props, p_platform: Platform.OS }).catch(() => {});
}
