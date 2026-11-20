import { useEffect, useState } from 'react';
import { LIVE, rpc } from './backend';
import type { Pool } from './pools';
import { toLocal } from './social';

/** Weekly crew titles, rolling 7 days of settled pools (0020_proof_titles.sql: titles_for). */
export interface Title { key: string; emoji: string; title: string; userId?: string; why: string; crew?: string }

const WEEK = 7 * 24 * 3600 * 1000;

/** Demo build: same rules as the server, over the pools you can see. */
export function computeTitles(pools: Pool[], createdBy: (p: Pool) => string | undefined = (p) => p.createdBy): Title[] {
  const since = Date.now() - WEEK;
  const per = new Map<string, { w: number; l: number; n: number; underdog: number }>();
  const started = new Map<string, number>();
  for (const p of pools) {
    const who = createdBy(p);
    if (who) started.set(who, (started.get(who) ?? 0) + 1);
    if (p.status !== 'resolved' || !p.resolvedOptionId) continue;
    if (p.closesAt && Date.parse(p.closesAt) < since) continue;
    for (const e of p.entries) {
      const side = p.entries.filter((x) => x.optionId === e.optionId).length;
      const won = e.optionId === p.resolvedOptionId;
      const r = per.get(e.userId) ?? { w: 0, l: 0, n: 0, underdog: 0 };
      r.n++; if (won) r.w++; else r.l++;
      if (won && side * 2 < p.entries.length) r.underdog++;
      per.set(e.userId, r);
    }
  }
  const rows = [...per.entries()];
  const best = <T,>(list: T[], score: (x: T) => number, tie: (x: T) => number = () => 0) =>
    list.slice().sort((a, b) => score(b) - score(a) || tie(b) - tie(a))[0];
  const out: Title[] = [];
  const oracle = best(rows.filter(([, r]) => r.w >= 2), ([, r]) => r.w, ([, r]) => -r.l);
  if (oracle) out.push({ key: 'oracle', emoji: '🔮', title: 'the oracle', userId: oracle[0], why: `${oracle[1].w} right calls` });
  const dog = best(rows.filter(([, r]) => r.underdog >= 1), ([, r]) => r.underdog, ([, r]) => r.w);
  if (dog) out.push({ key: 'underdog', emoji: '🐺', title: 'the underdog', userId: dog[0], why: `${dog[1].underdog} ${dog[1].underdog === 1 ? 'win' : 'wins'} against the crowd` });
  const wrong = best(rows.filter(([, r]) => r.l >= 2), ([, r]) => r.l, ([, r]) => -r.w);
  if (wrong) out.push({ key: 'wrong', emoji: '🤡', title: 'wrong again', userId: wrong[0], why: `${wrong[1].l} wrong calls` });
  const lead = best([...started.entries()].filter(([, n]) => n >= 2), ([, n]) => n);
  if (lead) out.push({ key: 'leader', emoji: '📣', title: 'ring leader', userId: lead[0], why: `${lead[1]} pools started` });
  const allin = best(rows.filter(([, r]) => r.n >= 3), ([, r]) => r.n);
  if (allin) out.push({ key: 'allin', emoji: '🎲', title: 'all in', userId: allin[0], why: `${allin[1].n} pools played` });
  return out;
}

type ServerTitle = { key: string; emoji: string; title: string; user?: string; why: string; crew?: string };
const fromServer = (t: ServerTitle): Title => ({ key: t.key, emoji: t.emoji, title: t.title, why: t.why, crew: t.crew, userId: toLocal(t.user) });

/** This week's titles in one crew. */
export function useCrewTitles(crewId: string, pools: Pool[]) {
  const [titles, setTitles] = useState<Title[]>([]);
  const demoKey = LIVE ? '' : pools.map((p) => p.id + p.status).join();
  useEffect(() => {
    if (!LIVE) { setTitles(computeTitles(pools)); return; }
    if (crewId.startsWith('crew-')) return;
    let alive = true;
    rpc<ServerTitle[]>('crew_titles', { p_group: crewId }).then((d) => { if (alive) setTitles((d ?? []).map(fromServer)); }).catch(() => {});
    return () => { alive = false; };
  }, [crewId, demoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return titles;
}

/** Titles you hold this week, across all your crews. */
export function useMyTitles(demoPools: () => Pool[] = () => []) {
  const [titles, setTitles] = useState<Title[]>([]);
  useEffect(() => {
    if (!LIVE) { setTitles(computeTitles(demoPools()).filter((t) => t.userId === 'me')); return; }
    let alive = true;
    rpc<ServerTitle[]>('my_titles').then((d) => { if (alive) setTitles((d ?? []).map(fromServer)); }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return titles;
}
