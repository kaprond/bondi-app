import { useEffect, useSyncExternalStore } from 'react';
import { ensureSession, LIVE, rpc, sb } from './backend';
import { toast } from './bus';
import { blockedTopic } from './moderation';
import { crewList, ME, toLocal } from './social';
import { track } from './track';

/** Quick polls: the crew votes, no coins, no settling (0022: polls, poll_votes). */
export interface Poll {
  id: string; groupId?: string; groupName: string; createdBy?: string; question: string; options: string[];
  closesAt?: string; createdAt: string; counts: number[]; voters: string[]; mine?: number;
}

type ServerPoll = { id: string; group_id: string; group_name: string; created_by: string | null; question: string; options: string[];
  closes_at: string | null; created_at: string; counts: number[]; voters: string[]; mine: number | null };

let polls: Poll[] = [];
const listeners = new Set<() => void>();
const changed = () => { polls = [...polls]; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const pollClosed = (p: Poll) => !!p.closesAt && Date.parse(p.closesAt) <= Date.now();

let loading: Promise<void> | null = null;
export function refreshPolls() {
  if (!LIVE) return Promise.resolve();
  if (loading) return loading;
  loading = rpc<ServerPoll[]>('my_polls').then((d) => {
    polls = (d ?? []).map((p) => ({
      id: p.id, groupId: p.group_id, groupName: p.group_name, createdBy: toLocal(p.created_by), question: p.question, options: p.options,
      closesAt: p.closes_at ?? undefined, createdAt: p.created_at, counts: (p.counts ?? []).map(Number), voters: (p.voters ?? []).map((v) => toLocal(v) ?? v),
      mine: p.mine ?? undefined,
    }));
    changed();
  }).catch(() => {}).finally(() => { loading = null; });
  return loading;
}

let wired = false;
function wireRealtime() {
  if (wired || !LIVE || !sb) return;
  wired = true;
  let soon: ReturnType<typeof setTimeout> | null = null;
  const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; refreshPolls(); }, 400); };
  const ch = sb.channel('polls')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, nudge)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, nudge);
  ensureSession().then(() => ch.subscribe()).catch(() => {});
}

/** All polls in your crews (last 30 days), newest first. Live. */
export function usePolls(): Poll[] {
  useEffect(() => { wireRealtime(); refreshPolls(); }, []);
  return useSyncExternalStore(subscribe, () => polls, () => polls);
}

/** Throws on bad input so the form can show it inline. */
export function createPoll(input: { crewName: string; question: string; options: string[]; closesAt?: string }) {
  const q = input.question.trim();
  const opts = input.options.map((o) => o.trim()).filter(Boolean);
  if (q.length < 3) throw new Error('write a question first.');
  if (opts.length < 2) throw new Error('add at least 2 options.');
  if (opts.length > 6) throw new Error('max 6 options.');
  const topic = blockedTopic(`${q} ${opts.join(' ')}`);
  if (topic) throw new Error(`polls about ${topic} aren’t allowed.`);
  const crew = crewList().find((c) => c.name === input.crewName) ?? crewList()[0];
  if (!crew) throw new Error('make a crew first.');
  if (crew.id.startsWith('crew-')) throw new Error('your new crew is still saving. try again in a second.');
  const p: Poll = { id: `tmp-${Date.now()}`, groupId: crew.id, groupName: crew.name, createdBy: ME, question: q, options: opts,
    closesAt: input.closesAt, createdAt: new Date().toISOString(), counts: opts.map(() => 0), voters: [] };
  polls = [p, ...polls]; changed();
  track('poll_created', { options: opts.length, deadline: !!input.closesAt });
  if (LIVE) rpc<string>('create_poll', { p_group: crew.id, p_question: q, p_options: opts, p_closes_at: input.closesAt ?? null })
    .then((id) => { p.id = id; changed(); }, (e: Error) => { polls = polls.filter((x) => x !== p); changed(); toast(e.message); })
    .finally(refreshPolls);
  return p;
}

/** Vote, or change your vote, until the poll closes. */
export function votePoll(id: string, option: number) {
  const p = polls.find((x) => x.id === id);
  if (!p) return;
  if (pollClosed(p)) throw new Error('this poll closed.');
  if (id.startsWith('tmp-')) throw new Error('still saving. one sec.');
  const counts = [...p.counts];
  if (p.mine !== undefined) counts[p.mine] = Math.max(0, counts[p.mine] - 1);
  counts[option] += 1;
  const voters = p.voters.includes(ME) ? p.voters : [...p.voters, ME];
  polls = polls.map((x) => (x.id === id ? { ...x, counts, voters, mine: option } : x)); changed();
  track('poll_voted');
  if (LIVE) rpc('vote_poll', { p_poll: id, p_option: option }).catch((e: Error) => toast(e.message)).finally(refreshPolls);
}

export function deletePoll(id: string) {
  polls = polls.filter((x) => x.id !== id); changed();
  if (LIVE && !id.startsWith('tmp-')) rpc('delete_poll', { p_poll: id }).catch((e: Error) => toast(e.message)).finally(refreshPolls);
}
