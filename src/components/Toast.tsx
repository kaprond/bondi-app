import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { colors, radius, shadow } from '../theme';
import { Coin, T } from './ui';

/** A pill that drops in from the top, stays ~2s, and leaves. Change `id` to show it again. */
export function Toast({ id, text, top, onDone }: { id: number; text: string; top: number; onDone: () => void }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const nd = Platform.OS !== 'web';
    y.setValue(0);
    Animated.sequence([
      Animated.spring(y, { toValue: 1, useNativeDriver: nd, damping: 12, stiffness: 200 }),
      Animated.delay(1800),
      Animated.timing(y, { toValue: 0, duration: 220, useNativeDriver: nd }),
    ]).start(({ finished }) => finished && onDone());
  }, [id, y, onDone]);
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { top, opacity: y, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] }]}>
      <Coin size={20} />
      <T weight="bold" color={colors.deep}>{text}</T>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10, ...shadow.soft },
});
