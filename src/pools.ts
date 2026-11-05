import { blockedTopic } from './moderation';
import { crewByName, ME, nameOf } from './social';

export { ME, nameOf };
export interface PoolOption { id: string; label: string; memberId?: string }
export type PoolStatus = 'pending_consent' | 'open' | 'proposed' | 'resolved' | 'voided' | 'rejected';
export interface Pool {
  id: string; groupName: string; question: string; stake: number; createdBy: string;
  subjectId?: string; status: PoolStatus; options: PoolOption[];
  entries: { userId: string; optionId: string }[];
  votes: { userId: string; confirm: boolean }[];
  proposedOptionId?: string; resolvedOptionId?: string;
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
    list: () => pools.map((p) => ({ ...p })),

    /** Put back pools saved on this device. */
    restore(saved: Pool[]) {
      pools = saved;
      seq = Math.max(seq, ...saved.map((p) => Number(p.id.slice(1)) || 0));
    },

    create(input: { question: string; stake: number; options: PoolOption[]; subjectId?: string; groupName?: string }): Pool {
      const topic = blockedTopic(input.question + ' ' + input.options.map((o) => o.label).join(' '));
      if (topic) throw new Error(`pools about ${topic} aren’t allowed. keep it fun for everyone.`);
      if (input.options.length < 2) throw new Error('add at least two outcomes.');
      const p: Pool = {
        id: nid(), groupName: input.groupName ?? 'house', question: input.question, stake: input.stake, createdBy: ME,
        subjectId: input.subjectId, status: input.subjectId ? 'pending_consent' : 'open',
        options: input.options, entries: [], votes: [],
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
