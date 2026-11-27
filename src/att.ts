import { Platform } from 'react-native';

/**
 * App Tracking Transparency prompt (iOS only), asked once after the profile is set up.
 * LetsJam does no cross-app tracking today; this keeps the App Store privacy answers and the binary consistent.
 */
let asked = false;
export async function askTrackingOnce() {
  if (Platform.OS !== 'ios' || asked) return;
  asked = true;
  try {
    const att = await import('expo-tracking-transparency');
    const cur = await att.getTrackingPermissionsAsync();
    if (cur.status === 'undetermined' && cur.canAskAgain) await att.requestTrackingPermissionsAsync();
  } catch { /* module missing in dev builds: ignore */ }
}
