export type Side = 'a' | 'b';

/** What a player is allowed to see before betting. No outcome, no reveal URL. */
export interface FeedClip {
  id: string;
  title: string;
  creator: string; // e.g. @bondi.originals
  question: string;
  labelA: string;
  labelB: string;
  oddsA: number;
  oddsB: number;
  teaserUrl: string | number; // URL, or a bundled asset on native
  crowdA: number; // % of players who picked A so far (shown after your reveal)
  commitHash: string; // sha256(id|outcome|salt), published before the clip went live
}

export interface BetResult {
  betId: string;
  won: boolean;
  payout: number; // total coins returned, 0 if lost
  outcome: Side;
  salt: string; // lets the player verify commitHash
  revealUrl: string | number; // only issued after the stake is debited
  balance: number;
}

export const STAKES = [10, 20, 50, 100] as const;
export type Stake = (typeof STAKES)[number];
