import { Platform } from 'react-native';
import { APP_URL, inviteCode, me } from './social';
import { Side } from './types';

/** A dare: one clip a friend sent you, and (once they had called it) what they picked. */
export interface Dare { clipId: string; from: string; pick?: Side }

const base = () => {
  const loc = (globalThis as { location?: Location }).location; // web only
  return loc?.origin?.startsWith('http') ? loc.origin : APP_URL;
};

/**
 * /c/<id> serves a small page whose link preview shows the paused frame and the question
 * (scripts/clip-pages.mjs), then opens the app on that clip. It carries your invite too.
 */
export function dareLink(clipId: string, pick?: Side): string {
  const q = new URLSearchParams({ from: me().handle, i: inviteCode() });
  if (pick) q.set('p', pick);
  return `${base()}/c/${encodeURIComponent(clipId)}?${q}`;
}

/** ?c=<clip>&from=<handle>[&p=a|b] on the web app's URL. */
export function readDare(): Dare | null {
  if (Platform.OS !== 'web') return null;
  try {
    const q = new URLSearchParams((globalThis as { location?: Location }).location?.search ?? '');
    const clipId = (q.get('c') ?? '').toLowerCase();
    const from = (q.get('from') ?? '').replace(/[^a-z0-9._]/gi, '').toLowerCase();
    const p = q.get('p');
    if (!/^[a-z][a-z0-9]{0,23}$/.test(clipId)) return null;
    return { clipId, from: from.length >= 3 ? from : 'a friend', pick: p === 'a' || p === 'b' ? p : undefined };
  } catch { return null; }
}

export const dareName = (d: Dare) => (d.from === 'a friend' ? d.from : `@${d.from}`);
