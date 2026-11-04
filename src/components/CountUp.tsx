import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { H } from './ui';

/** Animates a number from 0 to `to`, with an explicit sign. */
export function CountUp({ to, size, color, duration = 700 }: { to: number; size: number; color: string; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = v.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(v, { toValue: to, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [to, v, duration]);
  return <H size={size} color={color} style={{ fontVariant: ['tabular-nums'] }}>{shown >= 0 ? `+${shown}` : `${shown}`}</H>;
}
