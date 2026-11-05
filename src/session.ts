import { useSyncExternalStore } from 'react';
import { onHydrate, save } from './persist';
import { afterCall, dayKey, emptyToday, Today } from './missions';
import { weekKey } from './league';

/** Per-player stats for the demo build (server-side in the real app). */
export interface Call { clipId: string; title: string; pick: string; won: boolean; net: number; at: number }
export interface Stats {
  bets: number; wins: number; streak: number; bestStreak: number; coinsWon: number; history: Call[];
  today: Today;      // daily mission counters
  week: string;      // Monday of the current league week
  weekWon: number;   // coins won this week (league score)
}

let stats: Stats = { bets: 0, wins: 0, streak: 0, bestStreak: 0, coinsWon: 0, history: [], today: emptyToday(), week: weekKey(), weekWon: 0 };
const listeners = new Set<() => void>();
const emit = () => { save({ stats }); listeners.forEach((l) => l()); };

/** Day and week counters roll over on their own. */
function fresh(s: Stats): Stats {
  const day = dayKey(), week = weekKey();
  return { ...s, today: s.today?.day === day ? s.today : emptyToday(day), ...(s.week === week ? {} : { week, weekWon: 0 }) };
}
onHydrate((d) => { if (d.stats) stats = fresh({ ...stats, ...(d.stats as Stats) }); });

export function recordResult(won: boolean, net: number, call?: { clipId: string; title: string; pick: string; underdog?: boolean }) {
  const s = fresh(stats);
  const streak = won ? s.streak + 1 : 0;
  const history = call ? [{ clipId: call.clipId, title: call.title, pick: call.pick, won, net, at: Date.now() }, ...s.history].slice(0, 20) : s.history;
  stats = {
    ...s, bets: s.bets + 1, wins: s.wins + (won ? 1 : 0), streak, bestStreak: Math.max(s.bestStreak, streak),
    coinsWon: s.coinsWon + Math.max(net, 0), history,
    today: afterCall(s.today, won, !!call?.underdog), weekWon: s.weekWon + Math.max(net, 0),
  };
  emit();
}

/** A brag or an invite was shared (the "📣" mission). */
export function recordShare() {
  const s = fresh(stats);
  stats = { ...s, today: { ...s.today, shared: s.today.shared + 1 } };
  emit();
}

export function useStats(): Stats {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => stats, () => stats);
}

/** Sound on/off for the feed. Starts muted so autoplay is allowed; any tap can turn it on. */
let soundOn = false;
const soundListeners = new Set<() => void>();
export function setSound(on: boolean) { soundOn = on; soundListeners.forEach((l) => l()); }
export const soundIsOn = () => soundOn;
export function useSound(): boolean {
  return useSyncExternalStore((l) => { soundListeners.add(l); return () => soundListeners.delete(l); }, () => soundOn, () => soundOn);
}
