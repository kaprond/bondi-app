import { useSyncExternalStore } from 'react';
import { onHydrate, save } from './persist';

/** Per-player stats for the demo build (server-side in the real app). */
export interface Call { clipId: string; title: string; pick: string; won: boolean; net: number; at: number }
export interface Stats { bets: number; wins: number; streak: number; bestStreak: number; coinsWon: number; history: Call[] }

let stats: Stats = { bets: 0, wins: 0, streak: 0, bestStreak: 0, coinsWon: 0, history: [] };
const listeners = new Set<() => void>();
onHydrate((d) => { if (d.stats) stats = { ...stats, ...(d.stats as Stats) }; });

export function recordResult(won: boolean, net: number, call?: { clipId: string; title: string; pick: string }) {
  const streak = won ? stats.streak + 1 : 0;
  const history = call ? [{ ...call, won, net, at: Date.now() }, ...stats.history].slice(0, 20) : stats.history;
  stats = { bets: stats.bets + 1, wins: stats.wins + (won ? 1 : 0), streak, bestStreak: Math.max(stats.bestStreak, streak), coinsWon: stats.coinsWon + Math.max(net, 0), history };
  save({ stats });
  listeners.forEach((l) => l());
}

export function useStats(): Stats {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => stats, () => stats);
}

/** Sound on/off for the feed. Starts muted so autoplay is allowed; any tap can turn it on. */
let soundOn = false;
const soundListeners = new Set<() => void>();
export function setSound(on: boolean) { soundOn = on; soundListeners.forEach((l) => l()); }
export function useSound(): boolean {
  return useSyncExternalStore((l) => { soundListeners.add(l); return () => soundListeners.delete(l); }, () => soundOn, () => soundOn);
}
