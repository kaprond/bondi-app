import { Platform } from 'react-native';
import { LIVE, rpc } from './backend';
import app from '../app.json';

/** Crash and error reports to Supabase (0022: log_client_error), so bugs show up in /admin before anyone complains. */
export const APP_VERSION = `${app.expo.version} (${Platform.OS === 'ios' ? app.expo.ios?.buildNumber ?? '?' : 'web'})`;

const recent = new Map<string, number>();
let screen = 'start';
/** Remember roughly where the user was, for context in reports. */
export const setScreen = (name: string) => { screen = name; };

export function reportError(err: unknown, context: Record<string, unknown> = {}) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    const msg = (e.message || String(e)).slice(0, 500);
    const now = Date.now();
    if ((recent.get(msg) ?? 0) > now - 60000) return; // same error once a minute is plenty
    recent.set(msg, now);
    if (__DEV__) console.warn('[reportError]', msg, context);
    if (!LIVE) return;
    rpc('log_client_error', {
      p_message: `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${msg}`,
      p_stack: (e.stack ?? '').slice(0, 4000),
      p_context: { screen, ...context },
      p_platform: Platform.OS,
      p_version: APP_VERSION,
    }).catch(() => {});
  } catch { /* never let reporting crash the app */ }
}

let installed = false;
/** Catch uncaught errors and unhandled promise rejections, on native and web. */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler(): (e: Error, fatal?: boolean) => void; setGlobalHandler(h: (e: Error, fatal?: boolean) => void): void };
    addEventListener?: (t: string, h: (ev: { error?: unknown; reason?: unknown; message?: string }) => void) => void;
  };
  if (g.ErrorUtils) {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((e, fatal) => { reportError(e, { fatal: !!fatal }); prev(e, fatal); });
  }
  if (Platform.OS === 'web' && g.addEventListener) {
    g.addEventListener('error', (ev) => reportError(ev.error ?? ev.message, { kind: 'window.error' }));
    g.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, { kind: 'unhandledrejection' }));
  }
}
