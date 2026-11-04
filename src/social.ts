import { useSyncExternalStore } from 'react';

/**
 * Profiles, friends, invites and crews for the demo build.
 * In-memory mirror of supabase/migrations/0004_social.sql.
 */

export interface Person {
  id: string; handle: string; name: string; emoji: string; color: string; bio: string; city: string;
  stats: { calls: number; hitRate: number; poolsWon: number; bestStreak: number };
}
export interface Crew { id: string; name: string; emoji: string; memberIds: string[] }
export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';

export const ME = 'me';
export const AVATAR_EMOJI = ['😎', '🦊', '🐙', '🛵', '🌊', '🍕', '🎧', '🐸', '🦄', '🔥', '🌵', '🏄'];
export const AVATAR_COLORS = ['#0095B6', '#FFD639', '#E16632', '#2433A0', '#8FD3E3', '#14B87A', '#FF8FB1', '#005264'];

const people: Record<string, Person> = {
  me:     { id: ME, handle: 'you', name: 'you', emoji: '😎', color: '#0095B6', bio: 'calling it since day one', city: 'amsterdam', stats: { calls: 0, hitRate: 0, poolsWon: 0, bestStreak: 0 } },
  alex:   { id: 'alex', handle: 'alex.vdb', name: 'alex', emoji: '🦊', color: '#FFD639', bio: 'padel, plants, bad puns', city: 'amsterdam', stats: { calls: 142, hitRate: 57, poolsWon: 9, bestStreak: 7 } },
  sam:    { id: 'sam', handle: 'samsam', name: 'sam', emoji: '🍕', color: '#E16632', bio: 'never late. mostly.', city: 'utrecht', stats: { calls: 88, hitRate: 49, poolsWon: 4, bestStreak: 5 } },
  jordan: { id: 'jordan', handle: 'jrdn', name: 'jordan', emoji: '🎧', color: '#2433A0', bio: 'dj on weekends', city: 'rotterdam', stats: { calls: 203, hitRate: 61, poolsWon: 12, bestStreak: 11 } },
  taylor: { id: 'taylor', handle: 'tay', name: 'taylor', emoji: '🌊', color: '#8FD3E3', bio: 'surf, coffee, repeat', city: 'scheveningen', stats: { calls: 67, hitRate: 52, poolsWon: 3, bestStreak: 4 } },
  noor:   { id: 'noor', handle: 'noor.k', name: 'noor', emoji: '🦄', color: '#FF8FB1', bio: 'board game queen', city: 'amsterdam', stats: { calls: 51, hitRate: 55, poolsWon: 2, bestStreak: 6 } },
  mila:   { id: 'mila', handle: 'milaaa', name: 'mila', emoji: '🐸', color: '#14B87A', bio: 'running club captain', city: 'haarlem', stats: { calls: 119, hitRate: 58, poolsWon: 6, bestStreak: 8 } },
  daan:   { id: 'daan', handle: 'daan_rides', name: 'daan', emoji: '🛵', color: '#0095B6', bio: 'ex bondi rider', city: 'amsterdam', stats: { calls: 34, hitRate: 44, poolsWon: 1, bestStreak: 3 } },
  lotte:  { id: 'lotte', handle: 'lotte', name: 'lotte', emoji: '🌵', color: '#FFD639', bio: 'plant mum, quiz night regular', city: 'leiden', stats: { calls: 76, hitRate: 60, poolsWon: 5, bestStreak: 9 } },
  finn:   { id: 'finn', handle: 'finnster', name: 'finn', emoji: '🏄', color: '#005264', bio: 'will bet on the weather', city: 'den haag', stats: { calls: 22, hitRate: 41, poolsWon: 0, bestStreak: 2 } },
};

let friends = new Set(['alex', 'sam', 'jordan', 'taylor']);
let incoming = new Set(['noor']);
let outgoing = new Set<string>();
let crews: Crew[] = [
  { id: 'house', name: 'house', emoji: '🏠', memberIds: [ME, 'sam', 'jordan', 'taylor'] },
  { id: 'party', name: 'party crew', emoji: '🎉', memberIds: [ME, 'alex', 'sam', 'taylor'] },
  { id: 'college', name: 'college', emoji: '🎓', memberIds: [ME, 'alex', 'jordan', 'sam', 'taylor'] },
];
export const INVITE_CODE = 'BND-7Q4K';
export const inviteLink = `https://bondi.app/i/${INVITE_CODE}`;

let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((l) => l()); };
/** Re-render on any social change. */
export function useSocial(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => version);
}

export const person = (id: string): Person => people[id] ?? { ...people.me, id, handle: id, name: id, emoji: '🙂', color: '#54B8CE' };
export const nameOf = (id: string) => person(id).name;
export const me = () => people.me;

export function relation(id: string): Relation {
  if (id === ME) return 'self';
  if (friends.has(id)) return 'friend';
  if (incoming.has(id)) return 'incoming';
  if (outgoing.has(id)) return 'outgoing';
  return 'none';
}
export const friendList = () => [...friends].map(person);
export const incomingList = () => [...incoming].map(person);
export const outgoingList = () => [...outgoing].map(person);
/** People you might know: not you, not already connected. */
export const suggestions = () => Object.values(people).filter((p) => relation(p.id) === 'none');

export function search(q: string): Person[] {
  const s = q.trim().replace(/^@/, '').toLowerCase();
  if (s.length < 2) return [];
  return Object.values(people).filter((p) => p.id !== ME && (p.handle.includes(s) || p.name.includes(s)));
}

const HANDLE = /^[a-z0-9._]{3,20}$/;

export function updateProfile(patch: Partial<Pick<Person, 'name' | 'handle' | 'bio' | 'emoji' | 'color' | 'city'>>) {
  if (patch.handle !== undefined) {
    const h = patch.handle.trim().replace(/^@/, '').toLowerCase();
    if (!HANDLE.test(h)) throw new Error('handles are 3 to 20 characters: letters, numbers, dots and underscores.');
    if (Object.values(people).some((p) => p.id !== ME && p.handle === h)) throw new Error(`@${h} is taken.`);
    patch.handle = h;
  }
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('add a name.');
  if (patch.bio !== undefined && patch.bio.length > 80) throw new Error('keep your bio under 80 characters.');
  people.me = { ...people.me, ...patch, name: (patch.name ?? people.me.name).trim().toLowerCase() };
  emit();
}

export function syncMyStats(s: { calls: number; hitRate: number; bestStreak: number }) {
  people.me = { ...people.me, stats: { ...people.me.stats, ...s } };
}

export function sendRequest(id: string) {
  if (relation(id) !== 'none') return;
  outgoing.add(id); emit();
  // Demo: they accept a moment later. In the real app they get a push.
  setTimeout(() => { if (outgoing.delete(id)) { friends.add(id); emit(); } }, 2200);
}
export function respond(id: string, accept: boolean) {
  if (!incoming.delete(id)) return;
  if (accept) friends.add(id);
  emit();
}
export function cancelRequest(id: string) { if (outgoing.delete(id)) emit(); }
export function removeFriend(id: string) {
  if (!friends.delete(id)) return;
  crews = crews.map((c) => ({ ...c, memberIds: c.memberIds.filter((m) => m !== id) }));
  emit();
}

export const crewList = () => crews.map((c) => ({ ...c }));
export const crewByName = (name: string) => crews.find((c) => c.name === name);
export function createCrew(name: string, emoji: string, memberIds: string[]): Crew {
  const n = name.trim().toLowerCase();
  if (!n) throw new Error('give your crew a name.');
  if (crews.some((c) => c.name === n)) throw new Error('you already have a crew with that name.');
  const notFriends = memberIds.filter((m) => !friends.has(m));
  if (notFriends.length) throw new Error('you can only add friends to a crew.');
  if (memberIds.length < 1) throw new Error('add at least one friend.');
  const c: Crew = { id: `crew-${Date.now()}`, name: n, emoji, memberIds: [ME, ...memberIds] };
  crews = [...crews, c];
  emit();
  return c;
}
export function addToCrew(crewId: string, id: string) {
  if (!friends.has(id)) throw new Error('you can only add friends to a crew.');
  crews = crews.map((c) => (c.id === crewId && !c.memberIds.includes(id) ? { ...c, memberIds: [...c.memberIds, id] } : c));
  emit();
}

/**
 * Demo: which friends already played a clip and what they picked (deterministic per clip).
 * In the real app this comes from bets joined on friendships, shown only after you bet.
 */
export function friendCalls(clipId: string, crowdA: number): { id: string; side: 'a' | 'b' }[] {
  const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return [...friends]
    .filter((f) => hash(clipId + f) % 3 !== 0)
    .map((f) => ({ id: f, side: (hash(f + clipId) % 100 < crowdA ? 'a' : 'b') as 'a' | 'b' }));
}
