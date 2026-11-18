import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE, resetSession, rpc, sb } from './backend';
import { toast } from './bus';
import { person, refreshSocial, removeFriend, toServer, type Person } from './social';

/**
 * Report, block and delete account (App Store 1.2 and 5.1.1(v)).
 * Server twin: supabase/migrations/0011_account_safety.sql.
 */

export const REPORT_REASONS = [
  'mean or bullying',
  'about someone who didn’t agree',
  'sexual or creepy',
  'dangerous or illegal',
  'spam or scam',
  'something else',
] as const;

let blocked = new Map<string, Person>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((l) => l()); };
export function useBlocks(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => version);
}
export const blockedList = () => [...blocked.values()];
export const isBlocked = (id: string) => blocked.has(id);

export async function refreshBlocks(): Promise<void> {
  if (!LIVE) return;
  try {
    const rows = await rpc<{ id: string; handle: string | null; display_name: string | null; avatar_emoji: string; avatar_color: string }[]>('my_blocks');
    blocked = new Map(rows.map((r) => [r.id, { ...person(r.id), id: r.id, handle: r.handle ?? 'player', name: r.display_name ?? r.handle ?? 'player', emoji: r.avatar_emoji, color: r.avatar_color }]));
    emit();
  } catch { /* offline: keep what we have */ }
}

/** Block someone: they’re unfriended, can’t find or friend you, and their pools disappear for you. */
export async function blockUser(id: string): Promise<void> {
  const p = person(id);
  blocked.set(id, p);
  removeFriend(id);
  emit();
  if (LIVE) {
    try { await rpc('block_user', { p_other: toServer(id) }); }
    catch (e) { blocked.delete(id); emit(); toast((e as Error).message); return; }
    refreshSocial();
  }
  toast(`blocked @${p.handle}. you won’t see their pools.`);
}

export async function unblockUser(id: string): Promise<void> {
  const p = blocked.get(id);
  blocked.delete(id);
  emit();
  if (LIVE) {
    try { await rpc('unblock_user', { p_other: toServer(id) }); }
    catch (e) { if (p) blocked.set(id, p); emit(); toast((e as Error).message); return; }
  }
  toast(`unblocked @${p?.handle ?? 'player'}`);
}

/** Report a pool and/or a person. A human looks at every report. */
export async function report(input: { poolId?: string; userId?: string; reason: string }): Promise<void> {
  if (LIVE) {
    await rpc('report_content', { p_pool: input.poolId?.startsWith('tmp-') ? null : input.poolId ?? null, p_user: toServer(input.userId) ?? null, p_reason: input.reason });
  }
  toast('thanks. we’ll take a look within 24 hours.');
}

/**
 * Deletes your account for good: profile, coins, friends, crews you’re in, your entries.
 * Unsettled pools you made (or that are about you) are cancelled and everyone gets their coins back.
 * Then the app is wiped back to the welcome screen.
 */
export async function deleteAccount(): Promise<void> {
  if (LIVE) {
    await rpc('delete_my_account');
    await sb!.auth.signOut({ scope: 'local' }).catch(() => {});
    resetSession();
  }
  blocked = new Map();
  emit();
  await AsyncStorage.clear().catch(() => {});
}
