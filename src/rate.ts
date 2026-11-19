import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

const KEY = 'rate_asked_at';
const GAP = 60 * 24 * 3600 * 1000; // at most every ~60 days (Apple caps it at 3 a year anyway)

/** Ask for an App Store rating right after a win: the happiest moment we get. App only. */
export async function askForRatingAfterWin() {
  if (Platform.OS === 'web') return;
  try {
    const last = Number(await AsyncStorage.getItem(KEY)) || 0;
    if (Date.now() - last < GAP) return;
    if (!(await StoreReview.hasAction())) return;
    await AsyncStorage.setItem(KEY, String(Date.now()));
    setTimeout(() => { StoreReview.requestReview().catch(() => {}); }, 1500); // let the trophy land first
  } catch { /* never block the pool screen */ }
}
