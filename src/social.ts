import { useSyncExternalStore } from 'react';
import { onHydrate, save } from './persist';
import { LIVE, rpc, sb, ensureSession } from './backend';
import { toast } from './bus';

/**
 * Profiles, friends, invites and crews.
 * Demo build: in-memory mirror of supabase/migrations/0004_social.sql, seeded with sample friends.
 * Live build (LIVE): the same store is a cache of the server. Reads stay synchronous, every change
 * goes to an RPC and the cache is refreshed from my_social() afterwards and every 15 seconds.
 */

export interface Person {
  id: string; handle: string; name: string; emoji: string; color: string; bio: string; city: string;
  stats: { calls: number; hitRate: number; poolsWon: number; bestStreak: number };
}
export interface Crew { id: string; name: string; emoji: string; memberIds: string[] }
export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';

export const ME = 'me';
export const AVATAR_EMOJI = ['😎', '🦊', '🐙', '🛵', '🌊', '🍕', '🎧', '🐸', '🦄', '🔥', '🌵', '🏄'];
export const AVATAR_COLORS = ['#0095B6', '#F9C500', '#E16632', '#28275F', '#8FD3E3', '#14B87A', '#FF8FB1', '#005264'];

const people: Record<string, Person> = {
  me:     { id: ME, handle: 'you', name: 'you', emoji: '😎', color: '#0095B6', bio: 'calling it since day one', city: 'amsterdam', stats: { calls: 0, hitRate: 0, poolsWon: 0, bestStreak: 0 } },
  alex:   { id: 'alex', handle: 'alex.vdb', name: 'alex', emoji: '🦊', color: '#F9C500', bio: 'padel, plants, bad puns', city: 'amsterdam', stats: { calls: 142, hitRate: 57, poolsWon: 9, bestStreak: 7 } },
  sam:    { id: 'sam', handle: 'samsam', name: 'sam', emoji: '🍕', color: '#E16632', bio: 'never late. mostly.', city: 'utrecht', stats: { calls: 88, hitRate: 49, poolsWon: 4, bestStreak: 5 } },
  jordan: { id: 'jordan', handle: 'jrdn', name: 'jordan', emoji: '🎧', color: '#28275F', bio: 'dj on weekends', city: 'rotterdam', stats: { calls: 203, hitRate: 61, poolsWon: 12, bestStreak: 11 } },
  taylor: { id: 'taylor', handle: 'tay', name: 'taylor', emoji: '🌊', color: '#8FD3E3', bio: 'surf, coffee, repeat', city: 'scheveningen', stats: { calls: 67, hitRate: 52, poolsWon: 3, bestStreak: 4 } },
  noor:   { id: 'noor', handle: 'noor.k', name: 'noor', emoji: '🦄', color: '#FF8FB1', bio: 'board game queen', city: 'amsterdam', stats: { calls: 51, hitRate: 55, poolsWon: 2, bestStreak: 6 } },
  mila:   { id: 'mila', handle: 'milaaa', name: 'mila', emoji: '🐸', color: '#14B87A', bio: 'running club captain', city: 'haarlem', stats: { calls: 119, hitRate: 58, poolsWon: 6, bestStreak: 8 } },
  daan:   { id: 'daan', handle: 'daan_rides', name: 'daan', emoji: '🛵', color: '#0095B6', bio: 'ex bondi rider', city: 'amsterdam', stats: { calls: 34, hitRate: 44, poolsWon: 1, bestStreak: 3 } },
  lotte:  { id: 'lotte', handle: 'lotte', name: 'lotte', emoji: '🌵', color: '#F9C500', bio: 'plant mum, quiz night regular', city: 'leiden', stats: { calls: 76, hitRate: 60, poolsWon: 5, bestStreak: 9 } },
  finn:   { id: 'finn', handle: 'finnster', name: 'finn', emoji: '🏄', color: '#005264', bio: 'will bet on the weather', city: 'den haag', stats: { calls: 22, hitRate: 41, poolsWon: 0, bestStreak: 2 } },
};

if (LIVE) for (const id of Object.keys(people)) if (id !== ME) delete people[id];
let friends = new Set(LIVE ? [] : ['alex', 'sam', 'jordan', 'taylor']);
let incoming = new Set(LIVE ? [] : ['noor']);
let outgoing = new Set<string>();
let crews: Crew[] = LIVE ? [] : [
  { id: 'house', name: 'house', emoji: '🏠', memberIds: [ME, 'sam', 'jordan', 'taylor'] },
  { id: 'party', name: 'party crew', emoji: '🎉', memberIds: [ME, 'alex', 'sam', 'taylor'] },
  { id: 'college', name: 'college', emoji: '🎓', memberIds: [ME, 'alex', 'jordan', 'sam', 'taylor'] },
];
/** Where the web app lives. Invite links open it with ?i=<code>&from=<handle>. */
export const APP_URL = 'https://bondi-app-one.vercel.app';
const newCode = () => 'BND-' + Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
/** Each player gets their own code (server-side: invite_codes in 0004_social.sql). */
let myCode = newCode();
export const inviteCode = () => myCode;
export function inviteLink(): string {
  const loc = (globalThis as { location?: Location }).location; // web only
  const base = loc?.origin?.startsWith('http') ? loc.origin + (loc.pathname || '/').replace(/index\.html$/, '') : APP_URL + '/';
  return `${base}${base.endsWith('/') ? '' : '/'}?i=${myCode}&from=${encodeURIComponent(people.me.handle)}`;
}

let version = 0;
const listeners = new Set<() => void>();
const persist = () => save({ social: { me: people.me, extra: Object.values(people).filter((p) => p.id.startsWith('u:')), friends: [...friends], incoming: [...incoming], outgoing: [...outgoing], crews, code: myCode } });
const emit = () => { version++; persist(); listeners.forEach((l) => l()); };
onHydrate((d) => {
  if (LIVE) return; // the server is the source of truth
  const s = d.social as undefined | { me: Person; extra: Person[]; friends: string[]; incoming: string[]; outgoing: string[]; crews: Crew[]; code: string };
  if (!s) { persist(); return; }
  people.me = { ...people.me, ...s.me };
  for (const p of s.extra ?? []) people[p.id] = p;
  friends = new Set(s.friends); incoming = new Set(s.incoming); outgoing = new Set(s.outgoing);
  crews = s.crews ?? crews;
  if (s.code) myCode = s.code;
  // a request that was still pending when the page closed: in the demo they accept
  for (const id of outgoing) { outgoing.delete(id); friends.add(id); }
});
/** Re-render on any social change. */
export function useSocial(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => version);
}

// Live sync ----------------------------------------------------------------------
let myUid = '';
/** Server user id -> the id the app uses (you are always ME). */
export const toLocal = (uid?: string | null) => (!uid ? undefined : uid === myUid ? ME : uid);
/** App id -> server user id. */
export const toServer = (id?: string) => (!id ? undefined : id === ME ? myUid : id);

type Row = { id: string; handle: string | null; display_name: string | null; bio: string | null; city: string | null; avatar_emoji: string; avatar_color: string; calls: number; hit_rate: number };
const fromRow = (r: Row): Person => {
  const id = toLocal(r.id)!;
  const old = people[id];
  const handle = r.handle ?? (id === ME ? '' : 'player');
  return {
    id, handle, name: r.display_name ?? (handle || 'you'), emoji: r.avatar_emoji, color: r.avatar_color, bio: r.bio ?? '', city: r.city ?? '',
    stats: id === ME && old ? old.stats : { calls: r.calls, hitRate: r.hit_rate, poolsWon: old?.stats.poolsWon ?? 0, bestStreak: old?.stats.bestStreak ?? 0 },
  };
};

let inFlight: Promise<void> | null = null;
/** Pull your profile, friends, requests and crews from the server. Live build only. */
export function refreshSocial(): Promise<void> {
  if (!LIVE) return Promise.resolve();
  inFlight ??= (async () => {
    try {
      myUid = await ensureSession();
      const d = await rpc<{ me: string; code: string | null; people: Row[]; relations: { id: string; kind: Relation }[]; crews: { id: string; name: string; emoji: string; members: string[] }[] }>('my_social');
      for (const r of d.people) people[toLocal(r.id)!] = fromRow(r);
      friends = new Set(d.relations.filter((r) => r.kind === 'friend').map((r) => r.id));
      incoming = new Set(d.relations.filter((r) => r.kind === 'incoming').map((r) => r.id));
      outgoing = new Set(d.relations.filter((r) => r.kind === 'outgoing').map((r) => r.id));
      crews = d.crews.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, memberIds: c.members.map((m) => toLocal(m)!) }));
      if (d.code) myCode = d.code;
      emit();
    } catch (e) {
      console.warn('social sync failed', e);
    } finally { inFlight = null; }
  })();
  return inFlight;
}
if (LIVE) {
  refreshSocial();
  // Live: friend requests and crew changes arrive instantly; slow poll as a safety net.
  let soon: ReturnType<typeof setTimeout> | null = null;
  const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; refreshSocial(); }, 400); };
  const ch = sb!.channel('social-live');
  for (const table of ['friendships', 'group_members']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, nudge);
  ensureSession().then(() => ch.subscribe()).catch(() => {});
  setInterval(refreshSocial, 60000);
}

/** Run a server change, then re-sync. Errors show as a toast and the cache rolls back on the next sync. */
function remote(fn: string, args: Record<string, unknown>, after?: () => void) {
  rpc(fn, args).then(after, (e: Error) => toast(e.message)).finally(refreshSocial);
}

let searching: ReturnType<typeof setTimeout> | undefined;
function searchServer(q: string) {
  clearTimeout(searching);
  searching = setTimeout(async () => {
    try {
      const rows = await rpc<Row[]>('search_people', { p_q: q });
      for (const r of rows) people[toLocal(r.id)!] ??= fromRow(r);
      if (rows.length) emit();
    } catch { /* offline: show what we have */ }
  }, 250);
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
  if (LIVE) searchServer(s);
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
  if (LIVE) {
    const m = people.me;
    ensureSession().then(async (uid) => {
      const { error } = await sb!.from('profiles').update({ handle: m.handle || null, display_name: m.name.slice(0, 20), bio: m.bio, city: m.city.slice(0, 24), avatar_emoji: m.emoji, avatar_color: m.color }).eq('id', uid);
      if (error) toast(error.code === '23505' ? `@${m.handle} is taken.` : error.message);
    }).finally(refreshSocial);
  }
}

export function syncMyStats(s: { calls: number; hitRate: number; bestStreak: number }) {
  people.me = { ...people.me, stats: { ...people.me.stats, ...s } };
}

/**
 * Someone's invite link brought you here: you're friends straight away. Returns their name.
 * Live: new players become friends through redeem_invite; players who already had an account
 * (`request: true`) send a friend request instead.
 */
export function befriendInviter(handle: string, opts: { request?: boolean } = {}): Person {
  const h = handle.trim().replace(/^@/, '').toLowerCase().slice(0, 20);
  if (LIVE) {
    if (opts.request) remote('send_friend_request', { p_handle: h });
    return Object.values(people).find((x) => x.id !== ME && x.handle === h)
      ?? { ...people.me, id: `u:${h}`, handle: h, name: h, emoji: '🙂', color: '#54B8CE', bio: '', city: '', stats: { calls: 0, hitRate: 0, poolsWon: 0, bestStreak: 0 } };
  }
  let p = Object.values(people).find((x) => x.id !== ME && x.handle === h);
  if (!p) {
    const n = [...h].reduce((a, c) => a + c.charCodeAt(0), 0);
    p = { id: `u:${h}`, handle: h, name: h.split(/[._]/)[0] || h, emoji: AVATAR_EMOJI[n % AVATAR_EMOJI.length], color: AVATAR_COLORS[n % AVATAR_COLORS.length], bio: 'brought you to LetsJam', city: '', stats: { calls: 0, hitRate: 0, poolsWon: 0, bestStreak: 0 } };
    people[p.id] = p;
  }
  incoming.delete(p.id); outgoing.delete(p.id); friends.add(p.id);
  emit();
  return p;
}

export function sendRequest(id: string) {
  if (relation(id) !== 'none') return;
  outgoing.add(id); emit();
  if (LIVE) { remote('send_friend_request', { p_handle: person(id).handle }); return; }
  // Demo: they accept a moment later. In the real app they get a push.
  setTimeout(() => { if (outgoing.delete(id)) { friends.add(id); emit(); } }, 2200);
}
export function respond(id: string, accept: boolean) {
  if (!incoming.delete(id)) return;
  if (accept) friends.add(id);
  emit();
  if (LIVE) remote('respond_friend_request', { p_from: id, p_accept: accept });
}
export function cancelRequest(id: string) {
  if (!outgoing.delete(id)) return;
  emit();
  if (LIVE) remote('cancel_friend_request', { p_to: id });
}
export function removeFriend(id: string) {
  if (!friends.delete(id)) return;
  crews = crews.map((c) => ({ ...c, memberIds: c.memberIds.filter((m) => m !== id) }));
  emit();
  if (LIVE) remote('remove_friend', { p_other: id });
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
  if (LIVE) remote('create_crew', { p_name: n, p_emoji: emoji, p_members: memberIds });
  return c;
}
/**
 * First-run: a crew with just you, so you can invite people into it right away.
 * Resolves with the saved crew (live: server id, so the invite link works).
 */
export async function startCrew(name: string, emoji: string): Promise<Crew> {
  const n = name.trim().toLowerCase();
  if (!n) throw new Error('give your crew a name.');
  if (crews.some((c) => c.name === n)) throw new Error('you already have a crew with that name.');
  if (!LIVE) {
    const c: Crew = { id: `crew-${Date.now()}`, name: n, emoji, memberIds: [ME, ...[...friends].slice(0, 3)] };
    crews = [...crews, c];
    emit();
    return c;
  }
  const id = await rpc<string>('create_crew', { p_name: n, p_emoji: emoji, p_members: [] });
  await refreshSocial();
  return crews.find((c) => c.id === id) ?? { id, name: n, emoji, memberIds: [ME] };
}
/** WhatsApp-able link that drops people straight into one of your crews (and makes you friends). */
export const crewInviteLink = (crewId: string) => `${APP_URL}/c/${crewId}?i=${myCode}&from=${encodeURIComponent(people.me.handle)}`;

export function addToCrew(crewId: string, id: string) {
  if (!friends.has(id)) throw new Error('you can only add friends to a crew.');
  crews = crews.map((c) => (c.id === crewId && !c.memberIds.includes(id) ? { ...c, memberIds: [...c.memberIds, id] } : c));
  emit();
  if (LIVE) remote('add_to_crew', { p_group: crewId, p_user: id });
}

/**
 * Demo: which friends already played a clip and what they picked (deterministic per clip).
 * In the real app this comes from bets joined on friendships, shown only after you bet.
 */
export function friendCalls(clipId: string, crowdA: number): { id: string; side: 'a' | 'b' }[] {
  if (LIVE) return []; // no made-up picks for real friends
  const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return [...friends]
    .filter((f) => hash(clipId + f) % 3 !== 0)
    .map((f) => ({ id: f, side: (hash(f + clipId) % 100 < crowdA ? 'a' : 'b') as 'a' | 'b' }));
}
