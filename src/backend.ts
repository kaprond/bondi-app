import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, or null in the demo build.
 * Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to go live.
 * (Expo only inlines these when read as process.env.EXPO_PUBLIC_..., so keep them spelled out.)
 */
declare const process: { env: Record<string, string | undefined> };
declare const require: (m: string) => any; // Expo inlines these at build time
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Loaded lazily so the demo build and the node tests never pull in the native modules.
function connect(url: string, key: string): SupabaseClient {
  require('react-native-url-polyfill/auto');
  const storage = require('@react-native-async-storage/async-storage').default;
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  return createClient(url, key, { auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
}
export const sb: SupabaseClient | null = URL && KEY ? connect(URL, KEY) : null;

export const LIVE = sb !== null;

let session: Promise<string> | null = null;
/** Signs in (anonymously for now) once, and returns your user id. */
export function ensureSession(): Promise<string> {
  if (!sb) return Promise.reject(new Error('backend not configured'));
  session ??= (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session.user.id;
    const { data: d, error } = await sb.auth.signInAnonymously();
    if (error || !d.user) { session = null; throw error ?? new Error('could not sign in'); }
    return d.user.id;
  })();
  return session;
}

/** Calls an RPC after making sure you're signed in. Throws the server's message. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await sb!.rpc(fn, args);
  if (error) throw new Error(friendly(error.message, error.code));
  return data as T;
}

function friendly(msg: string, code?: string): string {
  if (code === '23505' && /handle/.test(msg)) return 'that handle is taken.';
  if (code === '23505') return 'already done.';
  return msg;
}
