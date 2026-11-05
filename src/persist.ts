/**
 * Saves the demo build's state on the device (localStorage on web), so a refresh keeps
 * your coins, calls, profile and friends. The real app keeps all of this in Supabase.
 */
const KEY = 'bondi.save.v1';
type Data = Record<string, unknown>;

let data: Data = {};
declare const require: (id: string) => { default: unknown };
// Loaded lazily so plain-node tests can import the stores without React Native.
const storage = () => require('@react-native-async-storage/async-storage').default as { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
let timer: ReturnType<typeof setTimeout> | undefined;
const hydrators: ((d: Data) => void)[] = [];

/** Stores register here at import time; they get the saved data once it has loaded. */
export function onHydrate(fn: (d: Data) => void) { hydrators.push(fn); }

export async function loadSave(): Promise<void> {
  try { data = JSON.parse((await storage().getItem(KEY)) ?? '{}') ?? {}; } catch { data = {}; }
  for (const h of hydrators) { try { h(data); } catch { /* a bad slice shouldn't block the app */ } }
}

export function save(patch: Data) {
  data = { ...data, ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { storage().setItem(KEY, JSON.stringify(data)).catch(() => {}); }, 120);
}
