import { Platform, Share } from 'react-native';

/**
 * Opens the system share sheet. On web without navigator.share, copies to the clipboard.
 * Resolves to 'shared', 'copied' or 'dismissed'.
 */
export async function shareText(message: string, url?: string): Promise<'shared' | 'copied' | 'dismissed'> {
  const full = url ? `${message} ${url}` : message;
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (nav?.share) {
      try { await nav.share({ text: message, url }); return 'shared'; } catch { return 'dismissed'; }
    }
    try { await nav?.clipboard?.writeText(full); return 'copied'; } catch { return 'dismissed'; }
  }
  const r = await Share.share({ message: full, url });
  return r.action === Share.sharedAction ? 'shared' : 'dismissed';
}
