import { BetResult, FeedClip, Side, Stake } from './types';

export interface BondiApi {
  getFeed(): Promise<FeedClip[]>;
  getBalance(): Promise<number>;
  claimDaily(): Promise<number>;
  placeBet(clipId: string, choice: Side, stake: Stake): Promise<BetResult>;
}

/**
 * In-memory stand-in for the Supabase backend (supabase/migrations/0001_init.sql).
 * Mirrors place_bet(): outcome and reveal URL stay private until the stake is debited.
 */
import { demoClip } from './demoClips';
const privateClips: Record<string, { outcome: Side; salt: string; revealUrl: string | number }> = {
  c1: { outcome: 'a', salt: 'bnd-2f22765d0493', revealUrl: demoClip('c1-reveal') },
  c2: { outcome: 'b', salt: 'bnd-6b1f53303a73', revealUrl: demoClip('c2-reveal') },
  c3: { outcome: 'a', salt: 'bnd-a625406f6977', revealUrl: demoClip('c3-reveal') },
};
const feed: FeedClip[] = [
  { id: 'c1', title: 'cup shot from the balcony', creator: '@bondi.originals', question: 'does it land in the cup?', labelA: 'lands it', labelB: 'misses', oddsA: 1.85, oddsB: 2.1, crowdA: 58, teaserUrl: demoClip('c1-teaser'), commitHash: '061e5cffc840422cc8ea8528ec3a5c9d37ded7f5f95cc12b1dba9847e8ad3491' },
  { id: 'c2', title: 'the slow slide', creator: '@bondi.originals', question: 'does it stop in time?', labelA: 'stops on the edge', labelB: 'slides off', oddsA: 1.9, oddsB: 1.9, crowdA: 71, teaserUrl: demoClip('c2-teaser'), commitHash: 'a1a6d4f722307e4091dd177ccefb969c7770632d5d0fca4f30f4cad88635b61b' },
  { id: 'c3', title: 'canal race, final 20 metres', creator: '@bondi.originals', question: 'who crosses first?', labelA: 'orange', labelB: 'blue', oddsA: 1.95, oddsB: 1.85, crowdA: 44, teaserUrl: demoClip('c3-teaser'), commitHash: '7eb159a1cc819a8dd9e56c831d94141cda07ae459cc4ed6e18d6d6251d1a2a3d' },
];

/** Demo wallet shared by the feed and friend pools. */
export const wallet = {
  balance: 1000, // signup grant, same as 0003_profiles_trigger.sql
  debit(n: number) { if (wallet.balance < n) return false; wallet.balance -= n; return true; },
  credit(n: number) { wallet.balance += n; },
};

export function createMockApi(): BondiApi {
  let lastDaily = '';
  const played = new Set<string>();
  return {
    async getFeed() { return feed.filter((c) => !played.has(c.id)); },
    async getBalance() { return wallet.balance; },
    async claimDaily() {
      const today = new Date().toISOString().slice(0, 10);
      if (lastDaily !== today) { lastDaily = today; wallet.credit(500); }
      return wallet.balance;
    },
    async placeBet(clipId, choice, stake) {
      const clip = feed.find((c) => c.id === clipId);
      const secret = privateClips[clipId];
      if (!clip || !secret) throw new Error('clip not available');
      if (played.has(clipId)) throw new Error('already played');
      if (!wallet.debit(stake)) throw new Error('Not enough coins');
      const won = choice === secret.outcome;
      const payout = won ? Math.floor(stake * (choice === 'a' ? clip.oddsA : clip.oddsB)) : 0;
      wallet.credit(payout);
      played.add(clipId);
      return { betId: `${clipId}-${Date.now()}`, won, payout, outcome: secret.outcome, salt: secret.salt, revealUrl: secret.revealUrl, balance: wallet.balance };
    },
  };
}

import { createSupabaseApi } from './supabaseApi';

const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Uses Supabase when configured, otherwise the in-memory demo backend. */
export const api: BondiApi = SB_URL && SB_KEY ? createSupabaseApi(SB_URL, SB_KEY) : createMockApi();
