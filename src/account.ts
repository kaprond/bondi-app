import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE, resetSession, sb } from './backend';
import { emit } from './bus';
import { track } from './track';

/**
 * Real login on top of the anonymous account everyone starts with.
 *
 * - "Save my account": links an email (6-digit code) or an Apple ID to the account you already have,
 *   so the user id, coins, friends and pools stay the same.
 * - "Log in": on a new phone, signs into an existing account with an email code or Apple.
 *   The anonymous account on this device is left behind (we warn first).
 * - "Log out": only offered once the account is saved, so nobody locks themselves out.
 */
export type Account = { kind: 'demo' | 'anonymous' | 'saved'; email?: string; apple?: boolean };

let state: Account = { kind: LIVE ? 'anonymous' : 'demo' };
let version = 0;
const listeners = new Set<() => void>();
const set = (a: Account) => { state = a; version++; listeners.forEach((l) => l()); };
export const account = () => state;
export function useAccount(): Account {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => version);
  return state;
}

export async function refreshAccount(): Promise<Account> {
  if (!sb) return state;
  const { data } = await sb.auth.getUser();
  const u = data.user;
  if (!u) return state;
  const apple = (u.identities ?? []).some((i) => i.provider === 'apple');
  const email = u.email || undefined;
  set({ kind: u.is_anonymous && !apple && !email ? 'anonymous' : 'saved', email, apple });
  return state;
}
if (sb) {
  refreshAccount().catch(() => {});
  sb.auth.onAuthStateChange(() => { refreshAccount().catch(() => {}); });
}

const cleanEmail = (e: string) => e.trim().toLowerCase();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function need() { if (!sb) throw new Error('accounts need the live app.'); return sb; }
function nice(msg?: string) {
  if (!msg) return 'something went wrong. try again.';
  if (/rate limit|too many|security purposes/i.test(msg)) return 'too many codes asked. wait a minute and try again.';
  if (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg)) return 'that code didn’t work. check it or ask for a new one.';
  if (/already (been )?registered|already exists|email_exists|identity_already_exists/i.test(msg)) return 'that one already has a LetsJam account. use “log in” instead.';
  if (/signups not allowed|user not found/i.test(msg)) return 'no LetsJam account with that email yet.';
  return msg;
}

/** Step 1 of saving with email: sends a 6-digit code to the address. */
export async function startSaveEmail(raw: string): Promise<string> {
  const email = cleanEmail(raw);
  if (!validEmail(email)) throw new Error('that doesn’t look like an email.');
  const { error } = await need().auth.updateUser({ email });
  if (error) throw new Error(nice(error.message));
  return email;
}
/** Step 2: the code from the email links it to this account. */
export async function finishSaveEmail(email: string, code: string): Promise<void> {
  const { error } = await need().auth.verifyOtp({ email, token: code.trim(), type: 'email_change' });
  if (error) throw new Error(nice(error.message));
  track('account_saved', { via: 'email' });
  await refreshAccount();
}

/** Log in on a new device, step 1: code to an email that already has an account. */
export async function startLogin(raw: string): Promise<string> {
  const email = cleanEmail(raw);
  if (!validEmail(email)) throw new Error('that doesn’t look like an email.');
  const { error } = await need().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new Error(nice(error.message));
  return email;
}
export async function finishLogin(email: string, code: string): Promise<void> {
  const { error } = await need().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) throw new Error(nice(error.message));
  await switched();
}

export const appleAvailable = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !LIVE) return false;
  try { return await require('expo-apple-authentication').isAvailableAsync(); } catch { return false; }
};

async function appleToken(): Promise<string | null> {
  const A = require('expo-apple-authentication');
  try {
    const c = await A.signInAsync({ requestedScopes: [A.AppleAuthenticationScope.EMAIL] });
    return c.identityToken ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

/** Save with Apple: links the Apple ID to this account. If that Apple ID already has an account, offers login instead. */
export async function saveWithApple(): Promise<'saved' | 'exists' | 'cancelled'> {
  const token = await appleToken();
  if (!token) return 'cancelled';
  const { error } = await need().auth.linkIdentity({ provider: 'apple', token });
  if (error) {
    if (/already|exists/i.test(error.message)) return 'exists';
    throw new Error(nice(error.message));
  }
  track('account_saved', { via: 'apple' });
  await refreshAccount();
  return 'saved';
}

/** Log in with Apple on a new device (or after saveWithApple said 'exists'). */
export async function loginWithApple(): Promise<boolean> {
  const token = await appleToken();
  if (!token) return false;
  const { error } = await need().auth.signInWithIdToken({ provider: 'apple', token });
  if (error) throw new Error(nice(error.message));
  await switched();
  return true;
}

/** Log out of a saved account; the app starts fresh as a new guest. */
export async function logOut(): Promise<void> {
  if (state.kind !== 'saved') throw new Error('save your account first, or you’ll lose it.');
  await need().auth.signOut({ scope: 'local' });
  await switched();
}

/** After changing accounts: drop cached local state and reload everything for the new user. */
async function switched() {
  resetSession();
  const keep = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
  // keep Supabase's own session keys and the 18+ confirmation; clear game caches
  const drop = keep.filter((k) => !k.startsWith('sb-') && k !== 'bondi.ageConfirmed');
  await AsyncStorage.removeMany(drop).catch(() => {});
  await refreshAccount();
  emit({ kind: 'reload' });
}
