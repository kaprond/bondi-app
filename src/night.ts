import { useEffect, useState } from 'react';
import { ensureSession, LIVE, rpc, sb } from './backend';
import { toast } from './bus';
import { blockedTopic } from './moderation';
import { ME, toLocal } from './social';
import { track } from './track';

/** Match night: a crew session with quick pools and a scoreboard for the night (0023: match_nights, crew_night). */
export interface NightRow { userId: string; played: number; won: number; net: number }
export interface Night { id: string; title: string; startedBy?: string; startedAt: string; endsAt: string; pools: number; board: NightRow[] }

type ServerNight = { id: string; title: string; started_by: string | null; started_at: string; ends_at: string; pools: number;
  board: { user: string; played: number; won: number; net: number }[] } | null;

const demo = new Map<string, Night>();

export function useCrewNight(crewId: string, poolsKey = '') {
  const [night, setNight] = useState<Night | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!LIVE) { const n = demo.get(crewId); setNight(n && Date.parse(n.endsAt) > Date.now() ? n : null); return; }
    if (crewId.startsWith('crew-')) return;
    let alive = true;
    rpc<ServerNight>('crew_night', { p_group: crewId }).then((d) => {
      if (!alive) return;
      setNight(d ? { id: d.id, title: d.title, startedBy: toLocal(d.started_by), startedAt: d.started_at, endsAt: d.ends_at, pools: Number(d.pools),
        board: (d.board ?? []).map((r) => ({ userId: toLocal(r.user) ?? r.user, played: Number(r.played), won: Number(r.won), net: Number(r.net) })) } : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [crewId, tick, poolsKey]);

  useEffect(() => {
    if (!LIVE || !sb || crewId.startsWith('crew-')) return;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; reload(); }, 500); };
    const ch = sb.channel(`night-${crewId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_nights', filter: `group_id=eq.${crewId}` }, nudge)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pools', filter: `group_id=eq.${crewId}` }, nudge);
    ensureSession().then(() => ch.subscribe()).catch(() => {});
    return () => { if (soon) clearTimeout(soon); sb!.removeChannel(ch); };
  }, [crewId]);

  return {
    night,
    /** Throws on a bad title so the sheet can show it. */
    async start(title: string, hours: number) {
      const t = title.trim();
      if (t.length < 2) throw new Error('what are you watching?');
      const topic = blockedTopic(t);
      if (topic) throw new Error(`keep it fun: no ${topic}.`);
      track('night_started', { hours });
      if (!LIVE) {
        demo.set(crewId, { id: `n-${Date.now()}`, title: t, startedBy: ME, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + hours * 3600000).toISOString(), pools: 0, board: [] });
        reload(); return;
      }
      await rpc('start_match_night', { p_group: crewId, p_title: t, p_hours: hours });
      reload();
    },
    end() {
      if (!LIVE) { demo.delete(crewId); reload(); return; }
      rpc('end_match_night', { p_group: crewId }).catch((e: Error) => toast(e.message)).finally(reload);
    },
  };
}
