import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BondiApi } from './api';
import { BetResult, FeedClip, Side, Stake } from './types';

/**
 * Real backend. Requires EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY,
 * plus an Edge Function `reveal-url` that returns a short-lived signed URL for a clip
 * the caller has already bet on (checked against public.bets).
 */
export function createSupabaseApi(url: string, anonKey: string): BondiApi {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });

  async function ensureSession() {
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
    }
  }

  return {
    async getFeed() {
      await ensureSession();
      const { data, error } = await sb.from('feed_clips').select('*').limit(20);
      if (error) throw error;
      return (data ?? []).map((r: any): FeedClip => ({
        id: r.id, title: r.title, creator: r.creator, question: r.question, labelA: r.label_a, labelB: r.label_b,
        oddsA: Number(r.odds_a), oddsB: Number(r.odds_b),
        teaserUrl: r.teaser_asset_id, crowdA: Number(r.crowd_a ?? 50), commitHash: r.commit_hash,
      }));
    },
    async getBalance() {
      await ensureSession();
      const { data } = await sb.from('balances').select('coins').maybeSingle();
      return Number(data?.coins ?? 0);
    },
    async getDaily() {
      await ensureSession();
      const { data, error } = await sb.rpc('daily_status');
      if (error) throw error;
      const r = (data as any[])[0];
      return { claimed: Boolean(r.claimed), dayStreak: Number(r.day_streak), amount: Number(r.amount) };
    },
    async claimDaily() {
      await ensureSession();
      const { data, error } = await sb.rpc('claim_daily');
      if (error) throw error;
      const r = (data as any[])[0];
      return { balance: Number(r.balance), amount: Number(r.amount), dayStreak: Number(r.day_streak) };
    },
    async redeemInvite(code: string) {
      await ensureSession();
      const { error } = await sb.rpc('redeem_invite', { p_code: code });
      if (error) throw new Error(error.message);
      const { data } = await sb.from('balances').select('coins').maybeSingle();
      return Number(data?.coins ?? 0);
    },
    async claimMission(id: string) {
      await ensureSession();
      const { data, error } = await sb.rpc('claim_mission', { p_mission: id });
      if (error) throw new Error(error.message);
      const r = (data as any[])[0];
      return { balance: Number(r.balance), reward: Number(r.reward) };
    },
    async placeBet(clipId: string, choice: Side, stake: Stake): Promise<BetResult> {
      await ensureSession();
      const { data, error } = await sb.rpc('place_bet', { p_clip: clipId, p_choice: choice, p_stake: stake });
      if (error) throw new Error(error.message);
      const r = (data as any[])[0];
      const reveal = await sb.functions.invoke('reveal-url', { body: { clipId } });
      if (reveal.error) throw reveal.error;
      return {
        betId: r.bet_id, won: r.won, payout: Number(r.payout), outcome: r.outcome, salt: r.salt,
        revealUrl: (reveal.data as { url: string }).url, balance: Number(r.balance),
      };
    },
  };
}
