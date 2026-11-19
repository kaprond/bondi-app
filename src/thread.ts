import { useEffect, useState } from 'react';
import { ensureSession, LIVE, rpc, sb } from './backend';
import { toast } from './bus';
import { blockedTopic } from './moderation';
import { ME, toLocal } from './social';
import { track } from './track';

/** Trash talk under a pool: comments + emoji reactions (0015_engage.sql). */
export const REACTIONS = ['🔥', '😂', '😱', '👀', '🫡', '💀'] as const;
export interface Comment { id: string; userId: string; body: string; at: string }
export interface Reaction { emoji: string; n: number; mine: boolean }
export interface Thread { comments: Comment[]; reactions: Reaction[] }

type ServerThread = { comments: { id: number; user: string; body: string; at: string }[]; reactions: Reaction[] } | null;

// Demo build: per-pool in-memory threads.
const demo = new Map<string, Thread>();
const demoThread = (id: string) => { if (!demo.has(id)) demo.set(id, { comments: [], reactions: [] }); return demo.get(id)!; };

async function load(poolId: string): Promise<Thread> {
  if (!LIVE) { const t = demoThread(poolId); return { comments: [...t.comments], reactions: t.reactions.map((r) => ({ ...r })) }; }
  const d = await rpc<ServerThread>('pool_thread', { p_pool: poolId });
  return {
    comments: (d?.comments ?? []).map((c) => ({ id: String(c.id), userId: toLocal(c.user) ?? 'gone', body: c.body, at: c.at })),
    reactions: d?.reactions ?? [],
  };
}

/** Live thread for one pool. Re-fetches on any comment/reaction change (RLS limits it to your crews). */
export function useThread(poolId: string) {
  const [thread, setThread] = useState<Thread>({ comments: [], reactions: [] });
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    load(poolId).then((t) => alive && setThread(t)).catch(() => {});
    return () => { alive = false; };
  }, [poolId, tick]);

  useEffect(() => {
    if (!LIVE || !sb) return;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; reload(); }, 300); };
    const ch = sb.channel(`thread-${poolId}`);
    for (const table of ['pool_comments', 'pool_reactions']) ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `pool_id=eq.${poolId}` }, nudge);
    ensureSession().then(() => ch.subscribe()).catch(() => {});
    return () => { if (soon) clearTimeout(soon); sb!.removeChannel(ch); };
  }, [poolId]);

  return {
    thread,
    /** Throws on a bad message (empty, blocked topic) so the screen can show it inline. */
    post(body: string) {
      const text = body.trim().slice(0, 280);
      if (!text) throw new Error('say something first.');
      const topic = blockedTopic(text);
      if (topic) throw new Error(`keep it fun: no ${topic}.`);
      const c: Comment = { id: `tmp-${Date.now()}`, userId: ME, body: text, at: new Date().toISOString() };
      setThread((t) => ({ ...t, comments: [...t.comments, c] }));
      track('comment_posted');
      if (!LIVE) { demoThread(poolId).comments.push(c); return; }
      rpc('add_comment', { p_pool: poolId, p_body: text }).catch((e: Error) => toast(e.message)).finally(reload);
    },
    remove(id: string) {
      setThread((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== id) }));
      if (!LIVE) { const t = demoThread(poolId); t.comments = t.comments.filter((c) => c.id !== id); return; }
      rpc('delete_comment', { p_id: Number(id) }).catch((e: Error) => toast(e.message)).finally(reload);
    },
    react(emoji: string) {
      const flip = (rs: Reaction[]) => {
        const r = rs.find((x) => x.emoji === emoji);
        if (!r) return [...rs, { emoji, n: 1, mine: true }];
        return rs.map((x) => (x.emoji !== emoji ? x : { ...x, n: x.n + (x.mine ? -1 : 1), mine: !x.mine })).filter((x) => x.n > 0);
      };
      setThread((t) => ({ ...t, reactions: flip(t.reactions) }));
      if (!LIVE) { const t = demoThread(poolId); t.reactions = flip(t.reactions); return; }
      rpc('toggle_reaction', { p_pool: poolId, p_emoji: emoji }).catch((e: Error) => toast(e.message)).finally(reload);
    },
  };
}
