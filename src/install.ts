import { Platform } from 'react-native';

/** The browser's install prompt, kept by a tiny script in public/index.html because it fires early. */
interface InstallEvent { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
type W = { __bondiInstall?: InstallEvent | null; navigator?: Navigator & { standalone?: boolean }; matchMedia?: (q: string) => MediaQueryList };
const w = globalThis as W;

/**
 * prompt: Chrome/Edge/Samsung can install with one tap.
 * ios: Safari on iPhone/iPad, which only installs through Share → Add to Home Screen.
 * none: already installed, desktop, native app, or a browser that can't.
 */
export function installKind(): 'prompt' | 'ios' | 'none' {
  if (Platform.OS !== 'web') return 'none';
  try {
    if (w.navigator?.standalone || w.matchMedia?.('(display-mode: standalone)').matches) return 'none';
    if (w.__bondiInstall) return 'prompt';
    const ua = w.navigator?.userAgent ?? '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (w.navigator?.maxTouchPoints ?? 0) > 1);
    // in-app browsers (Instagram, TikTok, WhatsApp...) can't add to the home screen
    if (ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV|TikTok|musical_ly|WhatsApp/.test(ua)) return 'ios';
  } catch { /* ignore */ }
  return 'none';
}

export async function promptInstall(): Promise<boolean> {
  const e = w.__bondiInstall;
  if (!e) return false;
  w.__bondiInstall = null; // a prompt can only be used once
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
