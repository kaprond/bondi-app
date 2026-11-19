import { blockedTopic } from './moderation';
import { crewByName, ME, nameOf, refreshSocial, toLocal, toServer } from './social';
import { ensureSession, LIVE, rpc, sb } from './backend';
import { toast } from './bus';
import { track } from './track';

export { ME, nameOf };
export interface PoolOption { id: string; label: string; memberId?: string }
export type PoolStatus = 'pending_consent' | 'open' | 'proposed' | 'resolved' | 'voided' | 'rejected';
export interface Pool {
  id: string; groupName: string; question: string; stake: number; createdBy: string;
  subjectId?: string; status: PoolStatus; options: PoolOption[];
  entries: { userId: string; optionId: string }[];
  votes: { userId: string; confirm: boolean }[];
  proposedOptionId?: string; resolvedOptionId?: string;
  /** ISO time after which nobody can join; the creator gets a nudge to call the result. */
  closesAt?: string;
  comments?: number;
}

/** Deadline helpers shared by the list and the pool screen. */
export const isClosed = (p: Pool) => !!p.closesAt && Date.parse(p.closesAt) <= Date.now();
export function timeLeft(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'closed';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ""} left`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h left`;
}


let seq = 0;
const nid = () => `p${++seq}`;

/** In-memory mirror of supabase/migrations/0002_friend_pools.sql */
export function createPoolsStore(debit: (n: number) => boolean, credit: (n: number) => void, onChange: (pools: Pool[]) => void = () => {}) {
  let pools: Pool[] = [
    {
      id: nid(), groupName: 'party crew', question: 'do we make the 07:10 train to barcelona?', stake: 50, createdBy: 'alex',
      status: 'open', options: [{ id: 'o1', label: 'yes, all of us' }, { id: 'o2', label: 'someone misses it' }],
      entries: [{ userId: 'alex', optionId: 'o2' }, { userId: 'sam', optionId: 'o1' }, { userId: 'taylor', optionId: 'o2' }], votes: [],
    },
    {
      id: nid(), groupName: 'house', question: 'who wins sunday’s padel final?', stake: 100, createdBy: 'sam',
      status: 'open', options: [{ id: 'o3', label: 'team jordan', memberId: 'jordan' }, { id: 'o4', label: 'team taylor', memberId: 'taylor' }],
      entries: [{ userId: 'sam', optionId: 'o3' }, { userId: 'alex', optionId: 'o4' }], votes: [],
    },
    {
      id: nid(), groupName: 'college', question: 'ajax vs psv: who scores first?', stake: 20, createdBy: 'taylor',
      status: 'resolved', options: [{ id: 'o5', label: 'ajax' }, { id: 'o6', label: 'psv' }],
      entries: [{ userId: 'taylor', optionId: 'o5' }, { userId: 'sam', optionId: 'o6' }, { userId: 'alex', optionId: 'o5' }, { userId: 'jordan', optionId: 'o5' }],
      votes: [], proposedOptionId: 'o5', resolvedOptionId: 'o5',
    },
  ];

  const controls = (p: Pool, uid: string) => uid === p.subjectId || p.options.some((o) => o.memberId === uid);

  return {
    live: false as const,
    list: () => pools.map((p) => ({ ...p })),
    subscribe(_l: () => void) { return () => {}; },
    refresh() {},
    consent(id: string, accept: boolean) {
      const p = pools.find((x) => x.id === id);
      if (p?.status === 'pending_consent') p.status = accept ? 'open' : 'rejected';
      onChange(pools);
    },

    /** Put back pools saved on this device. */
    restore(saved: Pool[]) {
      pools = saved;
      seq = Math.max(seq, ...saved.map((p) => Number(p.id.slice(1)) || 0));
    },

    create(input: { question: string; stake: number; options: PoolOption[]; subjectId?: string; groupName?: string; closesAt?: string }): Pool {
      const topic = blockedTopic(input.question + ' ' + input.options.map((o) => o.label).join(' '));
      if (topic) throw new Error(`pools about ${topic} aren’t allowed. keep it fun for everyone.`);
      if (input.options.length < 2) throw new Error('add at least two outcomes.');
      const p: Pool = {
        id: nid(), groupName: input.groupName ?? 'house', question: input.question, stake: input.stake, createdBy: ME,
        subjectId: input.subjectId, status: input.subjectId ? 'pending_consent' : 'open',
        options: input.options, entries: [], votes: [], closesAt: input.closesAt,
      };
      pools.unshift(p);
      onChange(pools);
      return p;
    },

    /** Demo only: the named subject accepts. In the real app they get a push notification. */
    simulateConsent(id: string) {
      const p = pools.find((x) => x.id === id)!;
      if (p.status === 'pending_consent') p.status = 'open';
      onChange(pools);
    },

    join(id: string, optionId: string) {
      const p = pools.find((x) => x.id === id)!;
      if (p.status !== 'open') throw new Error('this pool isn’t open.');
      if (controls(p, ME)) throw new Error('you’re part of this outcome, so you can’t stake on it.');
      if (p.entries.some((e) => e.userId === ME)) throw new Error('you’re already in.');
      if (isClosed(p)) throw new Error('this pool closed. wait for the result.');
      if (!debit(p.stake)) throw new Error('not enough coins.');
      p.entries.push({ userId: ME, optionId });
      // Demo: friends who don't control the outcome join too
      for (const m of crewByName(p.groupName)?.memberIds ?? []) {
        if (m !== ME && !controls(p, m) && !p.entries.some((e) => e.userId === m) && Math.random() < 0.7) {
          p.entries.push({ userId: m, optionId: p.options[Math.floor(Math.random() * p.options.length)].id });
        }
      }
      onChange(pools);
    },

    propose(id: string, optionId: string) {
      const p = pools.find((x) => x.id === id)!;
      if (p.status !== 'open') throw new Error('pool isn’t open.');
      p.status = 'proposed'; p.proposedOptionId = optionId; p.votes = [];
      onChange(pools);
    },

    vote(id: string, confirm: boolean) {
      const p = pools.find((x) => x.id === id)!;
      if (!p.entries.some((e) => e.userId === ME)) throw new Error('only people in the pool can vote.');
      p.votes = p.votes.filter((v) => v.userId !== ME).concat({ userId: ME, confirm });
      onChange(pools);
    },

    /** Demo shortcut for the 48h window: other participants confirm, then settle. */
    finalize(id: string) {
      const p = pools.find((x) => x.id === id)!;
      if (p.status !== 'proposed') return;
      for (const e of p.entries) if (!p.votes.some((v) => v.userId === e.userId)) p.votes.push({ userId: e.userId, confirm: Math.random() < 0.85 });
      const yes = p.votes.filter((v) => v.confirm).length;
      const winners = p.entries.filter((e) => e.optionId === p.proposedOptionId);
      const pot = p.entries.length * p.stake;
      if (yes * 2 > p.entries.length && winners.length > 0) {
        p.status = 'resolved'; p.resolvedOptionId = p.proposedOptionId;
        if (winners.some((w) => w.userId === ME)) credit(Math.floor(pot / winners.length));
      } else {
        p.status = 'voided';
        if (p.entries.some((e) => e.userId === ME)) credit(p.stake);
      }
      onChange(pools);
    },
  };
}
export type PoolsStore = ReturnType<typeof createPoolsStore>;

// Live pools ---------------------------------------------------------------------

type ServerPool = {
  id: string; group_id: string; group_name: string; question: string; stake: number; created_by: string; subject: string | null;
  status: PoolStatus | 'locked'; proposed: string | null; resolved: string | null; closes_at?: string | null; comments?: number;
  options: { id: string; label: string; member: string | null }[];
  entries: { user: string; option: string }[]; votes: { user: string; confirm: boolean }[];
};
const fromServer = (p: ServerPool): Pool => ({
  id: p.id, groupName: p.group_name, question: p.question, stake: Number(p.stake), createdBy: toLocal(p.created_by)!,
  subjectId: toLocal(p.subject), status: p.status === 'locked' ? 'open' : p.status,
  options: p.options.map((o) => ({ id: o.id, label: o.label, memberId: toLocal(o.member) })),
  entries: p.entries.map((e) => ({ userId: toLocal(e.user)!, optionId: e.option })),
  votes: p.votes.map((v) => ({ userId: toLocal(v.user)!, confirm: v.confirm })),
  proposedOptionId: p.proposed ?? undefined, resolvedOptionId: p.resolved ?? undefined,
  closesAt: p.closes_at ?? undefined, comments: Number(p.comments ?? 0),
});

/**
 * Same shape as the demo store, backed by the server. Checks that can fail fast run locally and
 * throw; the change itself goes to an RPC, then the pools and your balance are re-fetched.
 */
export function createLivePoolsStore(onChange: () => void = () => {}) {
  let pools: Pool[] = [];
  const listeners = new Set<() => void>();
  const changed = () => { onChange(); listeners.forEach((l) => l()); };

  async function refresh() {
    try {
      await refreshSocial(); // ids in pools map through your user id
      pools = (await rpc<ServerPool[]>('my_pools')).map(fromServer);
      changed();
    } catch (e) { console.warn('pools sync failed', e); }
  }
  const remote = (fn: string, args: Record<string, unknown>) => rpc(fn, args).catch((e: Error) => toast(e.message)).finally(refresh);
  const find = (id: string) => pools.find((x) => x.id === id);
  const controls = (p: Pool, uid: string) => uid === p.subjectId || p.options.some((o) => o.memberId === uid);

  refresh();
  // Live: re-sync as soon as anything in your pools changes (RLS limits it to pools you can see);
  // a slow poll stays as a safety net for dropped connections.
  let soon: ReturnType<typeof setTimeout> | null = null;
  const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; refresh(); }, 400); };
  if (sb) {
    const ch = sb.channel('pools-live');
    for (const table of ['pools', 'pool_entries', 'pool_votes', 'group_members']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, nudge);
    ensureSession().then(() => ch.subscribe()).catch(() => {});
  }
  setInterval(refresh, 60000);

  return {
    live: true as const,
    list: () => pools.map((p) => ({ ...p })),
    restore(_saved: Pool[]) { /* server is the source of truth */ },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    refresh,

    create(input: { question: string; stake: number; options: PoolOption[]; subjectId?: string; groupName?: string; closesAt?: string }): Pool {
      const topic = blockedTopic(input.question + ' ' + input.options.map((o) => o.label).join(' '));
      if (topic) throw new Error(`pools about ${topic} aren’t allowed. keep it fun for everyone.`);
      if (input.options.length < 2) throw new Error('add at least two outcomes.');
      const crew = crewByName(input.groupName ?? '');
      if (!crew) throw new Error('make a crew with your friends first.');
      if (crew.id.startsWith('crew-')) throw new Error('your new crew is still saving. try again in a second.');
      const p: Pool = {
        id: `tmp-${Date.now()}`, groupName: crew.name, question: input.question, stake: input.stake, createdBy: ME,
        subjectId: input.subjectId, status: input.subjectId ? 'pending_consent' : 'open', options: input.options, entries: [], votes: [],
        closesAt: input.closesAt,
      };
      pools.unshift(p);
      changed();
      track('pool_created', { stake: input.stake, deadline: !!input.closesAt, about_friend: !!input.subjectId });
      rpc<string>('create_pool', {
        p_group: crew.id, p_closes_at: input.closesAt ?? null, p_question: input.question, p_stake: input.stake, p_subject: toServer(input.subjectId) ?? null,
        p_options: input.options.map((o) => ({ label: o.label, member: toServer(o.memberId) ?? null })),
      }).then((id) => { p.id = id; }, (e: Error) => toast(e.message)).finally(refresh);
      return p;
    },

    /** The person a pool is about says yes or no. */
    consent(id: string, accept: boolean) { remote('consent_as_subject', { p_pool: id, p_accept: accept }); },
    simulateConsent(_id: string) { /* demo only */ },

    join(id: string, optionId: string) {
      const p = find(id);
      if (!p || p.status !== 'open') throw new Error('this pool isn’t open.');
      if (controls(p, ME)) throw new Error('you’re part of this outcome, so you can’t stake on it.');
      if (p.entries.some((e) => e.userId === ME)) throw new Error('you’re already in.');
      if (isClosed(p)) throw new Error('this pool closed. wait for the result.');
      p.entries.push({ userId: ME, optionId });
      changed();
      track('pool_joined');
      remote('join_pool', { p_pool: id, p_option: optionId });
    },

    propose(id: string, optionId: string) {
      const p = find(id);
      if (!p || p.status !== 'open') throw new Error('pool isn’t open.');
      p.status = 'proposed'; p.proposedOptionId = optionId; p.votes = [];
      changed();
      remote('propose_result', { p_pool: id, p_option: optionId });
    },

    vote(id: string, confirm: boolean) {
      const p = find(id);
      if (!p?.entries.some((e) => e.userId === ME)) throw new Error('only people in the pool can vote.');
      p.votes = p.votes.filter((v) => v.userId !== ME).concat({ userId: ME, confirm });
      changed();
      remote('vote_result', { p_pool: id, p_confirm: confirm });
    },

    /** Settles on the server 48 hours after the result is proposed (cron job). */
    finalize(_id: string) { /* demo only */ },
  };
}
export type LivePoolsStore = ReturnType<typeof createLivePoolsStore>;
export { LIVE };
