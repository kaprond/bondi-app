import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const PALETTE = [colors.yellow, colors.white, colors.sun, colors.orange, '#8FD3E3'];

/** A short burst of brand-coloured confetti. Skipped when the system asks for reduced motion. */
export function Confetti({ count = 28 }: { count?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: Math.random() * 100, drift: (Math.random() - 0.5) * 160, delay: Math.random() * 0.25,
    size: 7 + Math.random() * 7, rot: Math.random() * 720 - 360, color: PALETTE[i % PALETTE.length], round: Math.random() < 0.4,
  })), [count]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    Animated.timing(t, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [t]);

  if (reduce) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        const start = p.delay;
        const progress = t.interpolate({ inputRange: [0, start, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} style={{
            position: 'absolute', left: `${p.x}%`, top: -20, width: p.size, height: p.round ? p.size : p.size * 0.45,
            borderRadius: p.round ? p.size / 2 : 2, backgroundColor: p.color,
            opacity: progress.interpolate({ inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 620] }) },
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
            ],
          }} />
        );
      })}
    </View>
  );
}
