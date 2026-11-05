import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { dailyAmount, Daily } from '../api';
import { colors, radius, shadow } from '../theme';
import { Coin, H, PillButton, T } from './ui';

/** The once-a-day popup: today's coins, and what keeping the streak is worth. */
export function DailyReward({ daily, onClaim, onLater }: { daily: Daily; onClaim: () => Promise<void>; onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const nd = Platform.OS !== 'web';
    Animated.spring(pop, { toValue: 1, damping: 11, stiffness: 160, useNativeDriver: nd }).start();
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.quad), useNativeDriver: nd })).start();
  }, [pop, spin]);

  const n = daily.dayStreak;
  return (
    <View style={styles.scrim}>
      <Animated.View style={[styles.card, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
        <LinearGradient colors={[colors.sky, colors.brand]} style={styles.top}>
          <T weight="bold" color={colors.white}>{n > 1 ? `day ${n} in a row 🔥` : 'your daily coins'}</T>
          <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '8deg', '-8deg'] }) }] }}>
            <Coin size={64} />
          </Animated.View>
          <H size={56} color={colors.white}>+{daily.amount}</H>
        </LinearGradient>
        <View style={styles.body}>
          <View style={styles.days}>
            {[1, 2, 3, 4, 5, 6].map((d) => {
              const done = d < n, today = d === n || (d === 6 && n > 6);
              return (
                <View key={d} style={styles.day}>
                  <View style={[styles.dot, done && styles.dotDone, today && styles.dotToday]}>
                    <T size={11} weight="bold" color={done || today ? colors.deep : colors.muted}>{dailyAmount(d)}</T>
                  </View>
                  <T size={11} weight="semi" color={today ? colors.brand : colors.muted}>{d === 6 ? 'day 6+' : `day ${d}`}</T>
                </View>
              );
            })}
          </View>
          <T size={13} weight="semi" color={colors.muted} style={{ textAlign: 'center' }}>
            {n >= 6 ? 'max streak. keep it alive for 1,000 a day.' : `come back tomorrow for +${dailyAmount(n + 1)}. miss a day and it resets.`}
          </T>
          <PillButton label={`claim +${daily.amount} coins`} busy={busy} onPress={async () => { setBusy(true); try { await onClaim(); } finally { setBusy(false); } }} />
          <Pressable onPress={onLater} accessibilityRole="button" style={{ alignSelf: 'center', padding: 4 }}>
            <T size={13} weight="bold" color={colors.muted}>later</T>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 20 },
  card: { width: '100%', maxWidth: 360, borderRadius: radius.sheet, overflow: 'hidden', backgroundColor: colors.white, ...shadow.soft },
  top: { alignItems: 'center', paddingTop: 22, paddingBottom: 14, gap: 4 },
  body: { padding: 18, gap: 14 },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 4 },
  dot: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cloud, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.sun, borderColor: colors.sun },
  dotToday: { backgroundColor: colors.yellow, borderColor: colors.brand, borderWidth: 2.5 },
});
