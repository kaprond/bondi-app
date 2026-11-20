import { ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleProp, StyleSheet, Text, TextProps, View, ViewStyle } from 'react-native';
import { haptic } from '../haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius, shadow } from '../theme';

export function Wordmark({ size = 30, color = colors.white }: { size?: number; color?: string }) {
  return <Text style={{ fontFamily: fonts.displayHeavy, fontSize: size, color, letterSpacing: -size * 0.03, lineHeight: size * 1.15 }}>letsjam</Text>;
}

export function H({ size = 28, color = colors.deep, style, ...rest }: TextProps & { size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: fonts.display, fontSize: size, color, letterSpacing: -size * 0.035, lineHeight: size * 1.12 }, style]} />;
}

export function T({ color = colors.ink, size = 15, weight = 'medium', style, ...rest }: TextProps & { color?: string; size?: number; weight?: 'medium' | 'semi' | 'bold' }) {
  const fontFamily = weight === 'bold' ? fonts.bodyBold : weight === 'semi' ? fonts.bodySemi : fonts.body;
  return <Text {...rest} style={[{ fontFamily, fontSize: size, color, lineHeight: size * 1.35 }, style]} />;
}

/** Glossy pill button, like the site's "download now". */
export function PillButton({ label, onPress, disabled, busy, variant = 'brand', icon, style }: {
  label: string; onPress?: () => void; disabled?: boolean; busy?: boolean;
  variant?: 'brand' | 'white' | 'ghost' | 'orange'; icon?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const grad: Record<string, [string, string]> = {
    brand: ['#1FB3D3', colors.brand], orange: ['#F07B47', colors.orange], white: ['#FFFFFF', '#F2FAFC'], ghost: ['transparent', 'transparent'],
  };
  const fg = variant === 'white' ? colors.brand : variant === 'ghost' ? colors.deep : colors.white;
  return (
    <Pressable onPress={onPress ? () => { haptic.press(); onPress(); } : undefined} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ borderRadius: radius.pill, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        variant !== 'ghost' && shadow.button, variant === 'ghost' && { borderWidth: 1.5, borderColor: colors.line }, style]}>
      <LinearGradient colors={grad[variant]} style={styles.pill}>
        {variant !== 'ghost' && <View style={styles.gloss} />}
        {busy ? <ActivityIndicator color={fg} /> : (
          <View style={styles.pillRow}>{icon}<Text style={[styles.pillText, { color: fg }]}>{label}</Text></View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, disabled }: { label: string; active?: boolean; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress ? () => { haptic.tap(); onPress(); } : undefined} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, disabled && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.96 }] }]}>
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

/** Grey shimmer block while something loads (instead of "loading…"). */
export function Skeleton({ height = 16, width = '100%', radius: r = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: colors.tint, opacity: pulse }, style]} />;
}

/** A row of skeleton lines shaped like a list item. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ gap: 14 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Skeleton width={34} height={34} radius={17} />
          <View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="35%" height={11} /></View>
        </View>
      ))}
    </View>
  );
}

/** Screens slide up and fade in instead of popping. Respects reduced motion. */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!alive) return;
      if (reduce) t.setValue(1);
      else Animated.timing(t, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => t.setValue(1));
    return () => { alive = false; };
  }, [t]);
  return (
    <Animated.View style={[{ flex: 1, opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

export function Eyebrow({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'white' }) {
  return (
    <View style={[styles.eyebrow, tone === 'white' && { backgroundColor: colors.white }]}>
      <Text style={[styles.eyebrowText, tone === 'white' && { color: colors.deepFixed }]}>{label}</Text>
    </View>
  );
}

export function Coin({ size = 16 }: { size?: number }) {
  return (
    <LinearGradient colors={['#FFE98A', colors.sun]} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E9B800' }}>
      <Text style={{ fontFamily: fonts.displayHeavy, fontSize: size * 0.62, color: '#9A6B00', lineHeight: size * 0.8 }}>j</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  gloss: { position: 'absolute', top: 0, left: 10, right: 10, height: '48%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40, backgroundColor: 'rgba(255,255,255,0.18)' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 17 },
  chip: { flexGrow: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center' },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.deep },
  eyebrow: { alignSelf: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  eyebrowText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.white },
});
