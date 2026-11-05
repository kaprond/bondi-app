import { useSyncExternalStore } from 'react';
import { onHydrate, save } from './persist';
import { nextTier, standings, TIERS, weekKey } from './league';

/**
 * Your league tier, carried from week to week. When a new week starts, last week's final
 * rank decides whether you move up or down. Server-side this is a weekly job.
 */
type Friend = { id: string; name: string; emoji: string; color: string };
interface State { week: string; tier: number; myWon: number; friends?: Friend[]; last?: { week: string; rank: number; from: number; to: number; seen: boolean } }
let state: State = { week: weekKey(), tier: 0, myWon: 0 };
const listeners = new Set<() => void>();
const emit = () => { save({ league: state }); listeners.forEach((l) => l()); };

onHydrate((d) => {
  const s = d.league as State | undefined;
  if (!s) return;
  state = s;
  const now = weekKey();
  if (s.week !== now) {
    const rank = standings({ myWon: s.myWon, tier: s.tier, week: s.week, progress: 1, friends: s.friends }).find((r) => r.you)!.rank;
    const to = nextTier(s.tier, rank);
    state = { week: now, tier: to, myWon: 0, friends: s.friends, last: { week: s.week, rank, from: s.tier, to, seen: false } };
    save({ league: state });
  }
});

/** Keeps your score and your friends in this week's league up to date. */
export function syncLeague(weekWon: number, friends: Friend[]) {
  const f = friends.slice(0, 6).map(({ id, name, emoji, color }) => ({ id, name, emoji, color }));
  if (state.myWon === weekWon && state.week === weekKey() && JSON.stringify(f) === JSON.stringify(state.friends)) return;
  state = { ...state, week: weekKey(), myWon: weekWon, friends: f };
  emit();
}
export function markLeagueResultSeen() { if (state.last && !state.last.seen) { state = { ...state, last: { ...state.last, seen: true } }; emit(); } }
export const tierOf = (t: number) => TIERS[t];
export function useLeague(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
