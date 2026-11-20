import { useEffect, useState } from 'react';
import { ensureSession, LIVE, rpc, sb } from './backend';
import { toast } from './bus';
import { blockedTopic } from './moderation';
import type { Pool } from './pools';
import { ME, toLocal } from './social';
import { track } from './track';

/** One crew's timeline: chat, new pools, results, trash talk, joins (0021_feed_rivals.sql: crew_feed). */
export type FeedKind = 'message' | 'pool' | 'result' | 'comment' | 'joined' | 'poll';
export interface FeedItem { id: string; kind: FeedKind; at: string; userId?: string; body?: string; poolId?: string; question?: string; extra?: string }

type ServerItem = { id: string; kind: FeedKind; at: string; user?: string | null; body?: string | null; pool?: string | null; question?: string | null; extra?: string | null };

const demoMessages = new Map<string, FeedItem[]>();

/** Demo build: a timeline made from the pools you can see plus local messages. */
function demoFeed(crewId: string, pools: Pool[]): FeedItem[] {
  const items: FeedItem[] = [];
  const now = Date.now();
  pools.forEach((p, i) => {
    const at = new Date(now - (pools.length - i) * 3600000).toISOString();
    items.push({ id: `p${p.id}`, kind: 'pool', at, userId: p.createdBy, poolId: p.id, question: p.question, extra: p.forfeit });
    if (p.status === 'resolved') {
      const winner = p.options.find((o) => o.id === p.resolvedOptionId)?.label ?? '';
      const n = p.entries.filter((e) => e.optionId === p.resolvedOptionId).length;
      items.push({ id: `r${p.id}`, kind: 'result', at: new Date(Date.parse(at) + 1800000).toISOString(), poolId: p.id, question: p.question, extra: `${winner} · ${n} of ${p.entries.length} called it` });
    }
  });
  return [...items, ...(demoMessages.get(crewId) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
}

export function useCrewFeed(crewId: string, pools: Pool[]) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const demoKey = LIVE ? '' : pools.map((p) => p.id + p.status).join();

  useEffect(() => {
    if (!LIVE) { setItems(demoFeed(crewId, pools)); return; }
    if (crewId.startsWith('crew-')) { setItems([]); return; }
    let alive = true;
    rpc<ServerItem[] | null>('crew_feed', { p_group: crewId })
      .then((d) => { if (alive) setItems((d ?? []).map((x) => ({ id: x.id, kind: x.kind, at: x.at, userId: toLocal(x.user), body: x.body ?? undefined, poolId: x.pool ?? undefined, question: x.question ?? undefined, extra: x.extra ?? undefined }))); })
      .catch(() => { if (alive) setItems((cur) => cur ?? []); });
    return () => { alive = false; };
  }, [crewId, tick, demoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: refetch (debounced) when the crew chats, a pool changes or someone trash-talks.
  useEffect(() => {
    if (!LIVE || !sb || crewId.startsWith('crew-')) return;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; reload(); }, 400); };
    const ch = sb.channel(`feed-${crewId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_messages', filter: `group_id=eq.${crewId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pools', filter: `group_id=eq.${crewId}` }, nudge)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pool_comments' }, nudge)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_members', filter: `group_id=eq.${crewId}` }, nudge);
    ensureSession().then(() => ch.subscribe()).catch(() => {});
    return () => { if (soon) clearTimeout(soon); sb!.removeChannel(ch); };
  }, [crewId]);

  useEffect(() => { track('feed_viewed'); }, [crewId]);

  return {
    items,
    /** Throws on an empty or blocked message so the screen can show it inline. */
    post(body: string) {
      const text = body.trim().slice(0, 280);
      if (!text) throw new Error('say something first.');
      const topic = blockedTopic(text);
      if (topic) throw new Error(`keep it fun: no ${topic}.`);
      const m: FeedItem = { id: `tmp-${Date.now()}`, kind: 'message', at: new Date().toISOString(), userId: ME, body: text };
      setItems((cur) => [...(cur ?? []), m]);
      track('crew_message');
      if (!LIVE) { demoMessages.set(crewId, [...(demoMessages.get(crewId) ?? []), m]); return; }
      rpc('post_crew_message', { p_group: crewId, p_body: text }).catch((e: Error) => toast(e.message)).finally(reload);
    },
    remove(id: string) {
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
      if (!LIVE) { demoMessages.set(crewId, (demoMessages.get(crewId) ?? []).filter((x) => x.id !== id)); return; }
      if (/^\d+$/.test(id)) rpc('delete_crew_message', { p_id: Number(id) }).catch((e: Error) => toast(e.message)).finally(reload);
    },
  };
}
