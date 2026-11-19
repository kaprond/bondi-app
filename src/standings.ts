import { useEffect, useState } from 'react';
import { LIVE, rpc } from './backend';
import type { Pool } from './pools';
import { toLocal } from './social';

/** One crew member's season line (0016_rounds.sql: crew_standings). */
export interface Standing { userId: string; played: number; won: number; net: number; streak: number }
export type Period = 'month' | 'all';

type ServerRow = { user: string; played: number; won: number; net: number; streak: number };

/** Demo build: the same maths as the server, over the pools you can see. */
export function computeStandings(memberIds: string[], pools: Pool[], period: Period): Standing[] {
  const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
  const rows = new Map(memberIds.map((id) => [id, { userId: id, played: 0, won: 0, net: 0, streak: 0, broken: false }]));
  for (const p of pools) { // newest first, like the server's streak order
    if (p.status !== 'resolved' || !p.resolvedOptionId) continue;
    if (period === 'month' && p.closesAt && Date.parse(p.closesAt) < from.getTime()) continue;
    const pot = p.entries.length * p.stake;
    const winners = p.entries.filter((e) => e.optionId === p.resolvedOptionId).length;
    for (const e of p.entries) {
      const r = rows.get(e.userId);
      if (!r) continue;
      const won = e.optionId === p.resolvedOptionId;
      r.played++;
      if (won) r.won++;
      r.net += won ? Math.floor(pot / winners) - p.stake : -p.stake;
      if (!r.broken) { if (won) r.streak++; else r.broken = true; }
    }
  }
  return [...rows.values()].map(({ broken: _b, ...r }) => r).sort((a, b) => b.net - a.net || b.won - a.won);
}

export function useStandings(crewId: string, memberIds: string[], pools: Pool[], period: Period) {
  const [rows, setRows] = useState<Standing[] | null>(null);
  const demoKey = LIVE ? '' : pools.map((p) => p.id + p.status).join();
  useEffect(() => {
    if (!LIVE) { setRows(computeStandings(memberIds, pools, period)); return; }
    let alive = true;
    setRows(null);
    rpc<ServerRow[] | null>('crew_standings', { p_group: crewId, p_period: period })
      .then((d) => alive && setRows((d ?? []).map((r) => ({ userId: toLocal(r.user) ?? r.user, played: r.played, won: r.won, net: Number(r.net), streak: r.streak }))))
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [crewId, period, demoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}
