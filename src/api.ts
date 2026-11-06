import { BetResult, FeedClip, Side, Stake } from './types';
import { ClipDraft, CreatorClip, draftProblems, MAX_IN_REVIEW, simulatedPlays, simulatedTake, underCap } from './creator';

export interface Daily { claimed: boolean; dayStreak: number; amount: number }

export interface BondiApi {
  getFeed(): Promise<FeedClip[]>;
  getBalance(): Promise<number>;
  /** Today's reward: whether it's claimed, the day streak, and what claiming pays (or paid). */
  getDaily(): Promise<Daily>;
  claimDaily(): Promise<{ balance: number; amount: number; dayStreak: number }>;
  /** New players only. Both sides get 500 coins and become friends. Returns the new balance. */
  redeemInvite(code: string): Promise<number>;
  placeBet(clipId: string, choice: Side, stake: Stake): Promise<BetResult>;
  /** Pays a finished daily mission once per day. The server re-checks the mission against your bets. */
  claimMission(id: string): Promise<{ balance: number; reward: number }>;
  /**
   * Sends your clip for review. The outcome you declare is committed (hashed) right away and a
   * reviewer checks it against the video before the clip goes live. You can never call your own clip.
   */
  submitClip(draft: ClipDraft, video: { uri: string; mimeType?: string }): Promise<CreatorClip>;
  /** Your uploaded clips with plays and commission earned, plus your balance after any new commission. */
  getMyClips(): Promise<{ clips: CreatorClip[]; balance: number }>;
}

/** Daily reward grows with the day streak: 500 on day 1, +100 a day, capped at 1,000 from day 6. */
export const dailyAmount = (dayStreak: number) => 500 + 100 * (Math.min(Math.max(dayStreak, 1), 6) - 1);

/**
 * In-memory stand-in for the Supabase backend (supabase/migrations/0001_init.sql).
 * Mirrors place_bet(): outcome and reveal URL stay private until the stake is debited.
 */
import { demoClip } from './demoClips';
import { onHydrate, save } from './persist';
import { dayKey, MISSIONS } from './missions';
const secret = (outcome: Side, salt: string, id: string) => ({ outcome, salt, revealUrl: demoClip(`${id}-reveal`) });
const privateClips: Record<string, { outcome: Side; salt: string; revealUrl: string | number }> = {
  a1: secret('a', 'bnd-bdf7779d7f33', 'a1'),
  a2: secret('b', 'bnd-f04b3ac14e2b', 'a2'),
  a3: secret('b', 'bnd-b56ad1882801', 'a3'),
  a4: secret('a', 'bnd-b0557c56dec6', 'a4'),
  c2: secret('b', 'bnd-6b1f53303a73', 'c2'),
  c3: secret('a', 'bnd-a625406f6977', 'c3'),
  c4: secret('b', 'bnd-a6724d377c53', 'c4'),
  c5: secret('b', 'bnd-22bb56264cf4', 'c5'),
  c6: secret('a', 'bnd-7201e1d18903', 'c6'),
  c7: secret('b', 'bnd-42a8afca576a', 'c7'),
  c8: secret('a', 'bnd-4966e7600e82', 'c8'),
};
const O = '@bondi.originals';
const feed: FeedClip[] = [
  { id: 'a1', title: 'canal-side cup toss', creator: '@grachten.gang', question: 'does it land in the cup?', labelA: 'in the cup', labelB: 'misses', oddsA: 2.6, oddsB: 1.45, crowdA: 36, teaserUrl: demoClip('a1-teaser'), commitHash: 'ef85922984f5cd07302bdb895bc3ea17c2249c52d2256c55b035f88195971ee2' },
  { id: 'a2', title: 'the big stair set', creator: '@concrete.kid', question: 'does he roll away clean?', labelA: 'lands it', labelB: 'bails', oddsA: 1.95, oddsB: 1.85, crowdA: 61, teaserUrl: demoClip('a2-teaser'), commitHash: '7f4572e88d238df29ed8804985de9ad5941780be9ad146b765ee28d6787b77cc' },
  { id: 'a3', title: 'pumpkin vs the counter', creator: '@pumpkin.the.cat', question: 'does the cat pull itself up?', labelA: 'makes it', labelB: 'drops', oddsA: 1.8, oddsB: 2.0, crowdA: 57, teaserUrl: demoClip('a3-teaser'), commitHash: '45a1466855f3aab56e471023354ef8479b9dd32238c6e51c9575d847039ef387' },
  { id: 'a4', title: 'half-court at golden hour', creator: '@rooftop.hoops', question: 'is it going in?', labelA: 'buckets', labelB: 'miss', oddsA: 3.4, oddsB: 1.3, crowdA: 24, teaserUrl: demoClip('a4-teaser'), commitHash: '9ca4a15c3a2afab8717e6ed1e2345d24e3e58ecedfcc2406e1a47d4ce699d80b' },
  { id: 'c4', title: 'penalty in the park', creator: '@vondelpark.fc', question: 'does the keeper save it?', labelA: 'saved', labelB: 'goal', oddsA: 2.2, oddsB: 1.65, crowdA: 38, teaserUrl: demoClip('c4-teaser'), commitHash: 'f99663638c79dfb45a01da2f8d6a99dcfd17db91a05c5cb5ad5a7c7466e4905a' },
  { id: 'c2', title: 'the slow slide', creator: O, question: 'does it stop in time?', labelA: 'stops on the edge', labelB: 'slides off', oddsA: 1.9, oddsB: 1.9, crowdA: 71, teaserUrl: demoClip('c2-teaser'), commitHash: 'a1a6d4f722307e4091dd177ccefb969c7770632d5d0fca4f30f4cad88635b61b' },
  { id: 'c6', title: 'running for tram 2', creator: '@late.again', question: 'do they make the tram?', labelA: 'makes it', labelB: 'doors shut', oddsA: 1.9, oddsB: 1.9, crowdA: 47, teaserUrl: demoClip('c6-teaser'), commitHash: 'b142e378f6c3aab6ec15dc0ab85b7597b7c7f2eb4809ac3ebcc5c9893f910e41' },
  { id: 'c5', title: 'bottle flip, attempt 47', creator: '@flipdaily', question: 'does it land upright?', labelA: 'lands it', labelB: 'tips over', oddsA: 1.75, oddsB: 2.05, crowdA: 63, teaserUrl: demoClip('c5-teaser'), commitHash: '90f976ce5666a7574e1b19a021b84e823376dc096efd9c58a2beed7d9347e98a' },
  { id: 'c3', title: 'canal race, final 20 metres', creator: O, question: 'who crosses first?', labelA: 'orange', labelB: 'blue', oddsA: 1.95, oddsB: 1.85, crowdA: 44, teaserUrl: demoClip('c3-teaser'), commitHash: '7eb159a1cc819a8dd9e56c831d94141cda07ae459cc4ed6e18d6d6251d1a2a3d' },
  { id: 'c7', title: 'the domino run', creator: '@tinychaos', question: 'does the last one fall?', labelA: 'all fall', labelB: 'chain stops', oddsA: 1.6, oddsB: 2.3, crowdA: 74, teaserUrl: demoClip('c7-teaser'), commitHash: '6d53b6a49c00d8bea2e5e64cb9f4ec407078baab2bacf696e2d91de1b398feb7' },
  { id: 'c8', title: 'one more block', creator: '@tinychaos', question: 'does the tower hold?', labelA: 'holds', labelB: 'topples', oddsA: 2.0, oddsB: 1.8, crowdA: 41, teaserUrl: demoClip('c8-teaser'), commitHash: '4700c952b2bc9ea37f351a07ee2b7a8439efeeb57c207a0b1d32d5c91458d6ba' },
];

/** Demo wallet shared by the feed and friend pools. */
export const wallet = {
  balance: 1000, // signup grant, same as 0003_profiles_trigger.sql
  debit(n: number) { if (wallet.balance < n) return false; wallet.balance -= n; save({ balance: wallet.balance }); return true; },
  credit(n: number) { wallet.balance += n; save({ balance: wallet.balance }); },
};

const REVIEW_MS = 30_000;
const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function createMockApi(): BondiApi {
  let lastDaily = '';
  let dayStreak = 0;
  let redeemed = false;
  let missions: { day: string; ids: string[] } = { day: '', ids: [] };
  const played = new Set<string>();
  let mine: (CreatorClip & { accrued?: number })[] = [];
  let commissionDay = { day: '', paid: 0 };
  onHydrate((d) => {
    if (Array.isArray(d.myClips)) mine = d.myClips as typeof mine;
    if (d.commissionDay) commissionDay = d.commissionDay as typeof commissionDay;
    if (typeof d.balance === 'number') wallet.balance = d.balance;
    if (Array.isArray(d.played)) (d.played as string[]).forEach((id) => played.add(id));
    if (typeof d.lastDaily === 'string') lastDaily = d.lastDaily;
    if (typeof d.dayStreak === 'number') dayStreak = d.dayStreak;
    redeemed = d.redeemed === true;
    if (d.missions) missions = d.missions as typeof missions;
  });
  const streakIfClaimedToday = () => (lastDaily === day(-1) ? dayStreak + 1 : 1);
  return {
    async getFeed() { return feed.filter((c) => !played.has(c.id)); },
    async getBalance() { return wallet.balance; },
    async getDaily() {
      if (lastDaily === day()) return { claimed: true, dayStreak, amount: dailyAmount(dayStreak) };
      const next = streakIfClaimedToday();
      return { claimed: false, dayStreak: next, amount: dailyAmount(next) };
    },
    async claimDaily() {
      if (lastDaily === day()) return { balance: wallet.balance, amount: 0, dayStreak };
      dayStreak = streakIfClaimedToday();
      lastDaily = day();
      const amount = dailyAmount(dayStreak);
      wallet.credit(amount);
      save({ lastDaily, dayStreak });
      return { balance: wallet.balance, amount, dayStreak };
    },
    async redeemInvite(code) {
      if (!/^BND-[A-Z0-9]{4}$/.test(code.toUpperCase())) throw new Error('invite code not found');
      if (redeemed) throw new Error('you already used an invite code');
      redeemed = true;
      save({ redeemed });
      wallet.credit(500);
      return wallet.balance;
    },
    async claimMission(id) {
      const m = MISSIONS.find((x) => x.id === id);
      if (!m) throw new Error('unknown mission');
      if (missions.day !== dayKey()) missions = { day: dayKey(), ids: [] };
      if (missions.ids.includes(id)) return { balance: wallet.balance, reward: 0 };
      missions = { ...missions, ids: [...missions.ids, id] };
      save({ missions });
      wallet.credit(m.reward);
      return { balance: wallet.balance, reward: m.reward };
    },
    async submitClip(draft) {
      const problems = draftProblems(draft);
      if (problems.length) throw new Error(problems[0]);
      if (mine.filter((c) => c.status === 'review').length >= MAX_IN_REVIEW) throw new Error(`you have ${MAX_IN_REVIEW} clips waiting for review already`);
      const clip: CreatorClip = {
        id: `u${Date.now().toString(36)}`, title: draft.title.trim(), question: draft.question.trim(), labelA: draft.labelA.trim(), labelB: draft.labelB.trim(),
        outcome: draft.outcome!, pauseAt: draft.pauseAt, duration: draft.duration, status: 'review', createdAt: Date.now(), plays: 0, staked: 0, earned: 0,
      };
      mine = [clip, ...mine];
      save({ myClips: mine });
      return clip;
    },
    async getMyClips() {
      // Demo stand-in for the review queue and for other players: a clip passes review after
      // 30 seconds, then simulated players start calling it and commission comes in.
      const now = Date.now();
      if (commissionDay.day !== day()) commissionDay = { day: day(), paid: 0 };
      let changed = false;
      mine = mine.map((c) => {
        let n = c;
        if (n.status === 'review' && now - n.createdAt > REVIEW_MS) { n = { ...n, status: 'live', liveAt: n.createdAt + REVIEW_MS }; changed = true; }
        if (n.status !== 'live' || !n.liveAt) return n;
        const plays = simulatedPlays(n.id, (now - n.liveAt) / 60000);
        if (plays === n.plays) return n;
        const take = simulatedTake(n.id, plays);
        const pay = underCap(commissionDay.paid, take.earned - (n.accrued ?? n.earned));
        commissionDay.paid += pay;
        wallet.credit(pay);
        changed = true;
        return { ...n, plays, staked: take.staked, accrued: take.earned, earned: n.earned + pay };
      });
      if (changed) save({ myClips: mine, commissionDay });
      return { clips: mine.map(({ accrued, ...c }) => c), balance: wallet.balance };
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
      save({ played: [...played] });
      return { betId: `${clipId}-${Date.now()}`, won, payout, outcome: secret.outcome, salt: secret.salt, revealUrl: secret.revealUrl, balance: wallet.balance };
    },
  };
}

import { createSupabaseApi } from './supabaseApi';

const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Uses Supabase when configured, otherwise the in-memory demo backend. */
export const api: BondiApi = SB_URL && SB_KEY ? createSupabaseApi(SB_URL, SB_KEY) : createMockApi();
