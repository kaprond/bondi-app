import { blockedTopic } from './moderation';
import { Side } from './types';

/**
 * Creator clips: anyone can upload a clip, declare what happens, and earn coins every time
 * someone calls it. Mirrors supabase/migrations/0007_creator_clips.sql.
 *
 * Commission is paid by the house on top of the game, never taken from the player's stake or
 * payout, and it is the same whether the player wins or loses. So the creator earns from people
 * playing, not from people losing, and has no reason to steer anyone toward a side.
 */
export const COMMISSION_RATE = 0.05; // 5% of every stake on your clip
export const MIN_COMMISSION = 1; // a 10 or 20 coin call still pays 1
export const DAILY_COMMISSION_CAP = 2000; // per creator per day, so alt accounts can't farm coins
export const MAX_IN_REVIEW = 3; // clips one person can have waiting at once
export const MAX_SECONDS = 60;
export const MIN_TEASER_SECONDS = 2; // something has to happen before the pause
export const MIN_REVEAL_SECONDS = 1; // and something after it

export const commissionFor = (stake: number) => Math.max(MIN_COMMISSION, Math.floor(stake * COMMISSION_RATE));

export type CreatorStatus = 'review' | 'live' | 'rejected';

export interface ClipDraft {
  title: string;
  question: string;
  labelA: string;
  labelB: string;
  outcome: Side | null; // what really happens, declared before upload, checked by a reviewer
  pauseAt: number; // seconds into the video where it stops for the call
  duration: number; // seconds
  rights: boolean; // filmed it or has the rights, everyone in it agreed
}

export interface CreatorClip {
  id: string;
  title: string;
  question: string;
  labelA: string;
  labelB: string;
  outcome: Side;
  pauseAt: number;
  duration: number;
  status: CreatorStatus;
  reason?: string; // why it was not approved
  createdAt: number;
  liveAt?: number;
  plays: number;
  staked: number;
  earned: number;
}

/** Everything that stops a draft from being sent for review. Empty list means it can go. */
export function draftProblems(d: ClipDraft): string[] {
  const out: string[] = [];
  const t = (s: string) => s.trim();
  if (!d.duration) out.push('pick a video first');
  else {
    if (d.duration > MAX_SECONDS + 0.5) out.push(`keep it under ${MAX_SECONDS} seconds`);
    if (d.pauseAt < MIN_TEASER_SECONDS) out.push(`pause at least ${MIN_TEASER_SECONDS}s in, so people see the setup`);
    if (d.duration - d.pauseAt < MIN_REVEAL_SECONDS) out.push('leave at least a second after the pause for the reveal');
  }
  if (t(d.title).length < 3) out.push('give it a title');
  if (t(d.question).length < 5) out.push('ask what happens next');
  if (!t(d.labelA) || !t(d.labelB)) out.push('fill in both answers');
  else if (t(d.labelA).toLowerCase() === t(d.labelB).toLowerCase()) out.push('the two answers need to be different');
  if (!d.outcome) out.push('tell us which answer really happens');
  if (!d.rights) out.push('confirm the clip is yours and everyone in it agreed');
  const topic = blockedTopic([d.title, d.question, d.labelA, d.labelB].join(' '));
  if (topic) out.push(`no clips about ${topic}`);
  for (const s of [d.title, d.question, d.labelA, d.labelB]) if (s.length > 60) { out.push('keep the text short (60 characters max)'); break; }
  return out;
}

// Small seeded RNG so the demo's simulated players are the same on every refresh.
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const STAKES = [10, 20, 50, 100];

/**
 * Demo only: how many simulated players have called a live clip after `minutes`.
 * Fast at first, then slowing down, like a real clip in the feed. Only ever grows.
 */
export function simulatedPlays(id: string, minutes: number): number {
  if (minutes <= 0) return 0;
  const r = rng(`plays:${id}`);
  const pull = 2 + r() * 4; // how catchy this clip is
  return Math.min(5000, Math.floor(pull * 3 * Math.sqrt(minutes) + Math.min(minutes, 3) * pull));
}

/** Demo only: the stakes and commission for the first `plays` simulated calls on a clip. */
export function simulatedTake(id: string, plays: number): { staked: number; earned: number } {
  const r = rng(`stakes:${id}`);
  let staked = 0, earned = 0;
  for (let i = 0; i < plays; i++) {
    const x = r();
    const stake = STAKES[x < 0.4 ? 0 : x < 0.7 ? 1 : x < 0.9 ? 2 : 3];
    staked += stake;
    earned += commissionFor(stake);
  }
  return { staked, earned };
}

/** Caps a creator's commission for the day. Returns what can still be paid out of `amount`. */
export const underCap = (paidToday: number, amount: number) => Math.max(0, Math.min(amount, DAILY_COMMISSION_CAP - paidToday));
