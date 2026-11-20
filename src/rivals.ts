import { useEffect, useState } from 'react';
import { LIVE, rpc } from './backend';
import type { Pool } from './pools';
import { ME, toLocal } from './social';

/** Head-to-head with a friend: pools where you picked different sides (0021_feed_rivals.sql: my_rivals). */
export interface Rival { userId: string; me: number; them: number; last?: string }

/** Demo build: same rule as the server. */
export function computeRivals(pools: Pool[]): Rival[] {
  const map = new Map<string, Rival>();
  for (const p of pools) {
    if (p.status !== 'resolved' || !p.resolvedOptionId) continue;
    const mine = p.entries.find((e) => e.userId === ME);
    if (!mine) continue;
    for (const o of p.entries) {
      if (o.userId === ME || o.optionId === mine.optionId) continue;
      const r = map.get(o.userId) ?? { userId: o.userId, me: 0, them: 0 };
      if (mine.optionId === p.resolvedOptionId) r.me++;
      if (o.optionId === p.resolvedOptionId) r.them++;
      map.set(o.userId, r);
    }
  }
  return [...map.values()].filter((r) => r.me + r.them > 0).sort((a, b) => b.me + b.them - (a.me + a.them));
}

let cache: Rival[] | null = null;

/** All your rivalries, most-played first. `demoPools` feeds the demo build. */
export function useRivals(demoPools: () => Pool[] = () => []) {
  const [rivals, setRivals] = useState<Rival[]>(cache ?? []);
  useEffect(() => {
    if (!LIVE) { setRivals(computeRivals(demoPools())); return; }
    let alive = true;
    rpc<{ user: string; me: number; them: number; last?: string }[]>('my_rivals')
      .then((d) => { cache = (d ?? []).map((r) => ({ userId: toLocal(r.user) ?? r.user, me: Number(r.me), them: Number(r.them), last: r.last })); if (alive) setRivals(cache); })
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return rivals;
}

/** "you 7 – 4 max" style line. */
export const scoreLine = (r: Rival, name: string) => `you ${r.me} – ${r.them} ${name}`;
export const rivalryMood = (r: Rival) => (r.me > r.them ? 'you own this one 😎' : r.me < r.them ? 'they’ve got your number 😬' : 'dead even 🤝');
