import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE, rpc } from './backend';
import { emit } from './bus';
import { track } from './track';

/**
 * Push notifications (iPhone/Android app only). The database sends them through Expo when
 * a friend request lands, a pool opens in your crew, someone joins yours, a result needs your vote,
 * or a pool settles (supabase/migrations/0013_push.sql).
 */
const ASKED = 'letsjam.pushAsked';
const native = Platform.OS === 'ios' || Platform.OS === 'android';
export const pushSupported = native && LIVE;

let N: typeof import('expo-notifications') | null = null;
function lib() {
  if (!pushSupported) return null;
  N ??= require('expo-notifications');
  return N;
}

/** Should we show the "turn on notifications" card? Only once, and only in the app. */
export async function shouldOfferPush(): Promise<boolean> {
  const n = lib(); if (!n) return false;
  if ((await AsyncStorage.getItem(ASKED).catch(() => null)) === '1') return false;
  const p = await n.getPermissionsAsync();
  return p.status !== 'granted' && p.canAskAgain !== false;
}
export const dismissPushOffer = () => AsyncStorage.setItem(ASKED, '1').catch(() => {});

/** Ask iOS for permission (once) and register this phone. Safe to call on every launch. */
export async function enablePush(ask: boolean): Promise<boolean> {
  const n = lib(); if (!n) return false;
  let { status } = await n.getPermissionsAsync();
  if (status !== 'granted' && ask) { status = (await n.requestPermissionsAsync()).status; await dismissPushOffer(); }
  if (status !== 'granted') return false;
  try {
    const Constants = require('expo-constants').default;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const { data: token } = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (ask) track('push_enabled');
    return true;
  } catch (e) { console.warn('push register failed', e); return false; }
}

/** Show pushes while the app is open, and open the right screen when one is tapped. */
export function wirePush(): () => void {
  const n = lib(); if (!n) return () => {};
  n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  const open = (data: Record<string, unknown> | undefined) => {
    if (data?.go === 'pool') emit({ kind: 'go', to: 'pools', poolId: typeof data.id === 'string' ? data.id : undefined });
    else if (data?.go === 'friends') emit({ kind: 'go', to: 'friends' });
  };
  n.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data as Record<string, unknown>)).catch(() => {});
  const sub = n.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data as Record<string, unknown>));
  enablePush(false).catch(() => {}); // refresh the token if permission was already given
  return () => sub.remove();
}
