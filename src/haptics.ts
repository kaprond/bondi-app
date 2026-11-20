import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Small, native-only haptics. Never throws, never runs on web. */
const native = Platform.OS === 'ios' || Platform.OS === 'android';
export const haptic = {
  /** chips, toggles, tabs */
  tap() { if (native) Haptics.selectionAsync().catch(() => {}); },
  /** buttons */
  press() { if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  /** locked in a pick, made a pool, won */
  success() { if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  /** lost, error */
  warn() { if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
};
