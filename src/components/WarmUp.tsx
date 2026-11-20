import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '../theme';
import { Coin, H, PillButton, T } from './ui';
import { Confetti } from './Confetti';
import { sfx } from '../sfx';
import { track } from '../track';

type Side = 'heads' | 'tails';
const STAKE = 2;

/**
 * First minute: a 10-second practice pool before anything else.
 * Three practice bots are already in, you call heads or tails, the coin flips, the pot splits.
 * Practice coins only: nothing touches your real balance.
 */
export function WarmUp({ topInset, bottomInset, onDone }: { topInset: number; bottomInset: number; onDone: () => void }) {
  const bots = useMemo(() => {
    const picks: Side[] = Math.random() < 0.5 ? ['heads', 'heads', 'tails'] : ['tails', 'tails', 'heads'];
    return [
      { name: 'noor', emoji: '🦊', color: '#F9C500', pick: picks[0] },
      { name: 'sem', emoji: '🐙', color: '#E16632', pick: picks[1] },
      { name: 'lisa', emoji: '🌵', color: '#14B87A', pick: picks[2] },
    ];
  }, []);
  const [mine, setMine] = useState<Side | null>(null);
  const [result, setResult] = useState<Side | null>(null);
  const spin = useRef(new Animated.Value(0)).current;
  const started = useRef(Date.now());

  useEffect(() => { track('warmup_seen'); }, []);

  const call = (side: Side) => {
    if (mine) return;
    setMine(side); sfx.lock();
    const land: Side = Math.random() < 0.5 ? 'heads' : 'tails';
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      setResult(land);
      const won = land === side;
      if (won) sfx.win(); else sfx.lose();
      track('warmup_played', { won, secs: Math.round((Date.now() - started.current) / 1000) });
    });
  };

  const players = [...bots.map((b) => b.pick), mine].filter(Boolean) as Side[];
  const pot = (bots.length + (mine ? 1 : 0)) * STAKE;
  const winners = result ? players.filter((p) => p === result).length : 0;
  const each = winners ? Math.floor(pot / winners) : 0;
  const won = result != null && mine === result;
  const turns = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1800deg'] });

  return (
    <LinearGradient colors={[colors.royal, '#1765A9']} style={{ flex: 1 }}>
      {won && <Confetti />}
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: topInset + 20, paddingBottom: bottomInset + 24 }]}>
        <View style={styles.between}>
          <T weight="bold" color={colors.white}>warm-up round</T>
          {!result && (
            <Pressable onPress={() => { track('first_run_skipped', { at: 'warmup' }); onDone(); }} hitSlop={10} accessibilityRole="button">
              <T weight="bold" color={colors.white}>skip</T>
            </Pressable>
          )}
        </View>
        <H size={38} color={colors.white}>heads or <H size={38} color={colors.yellow}>tails?</H></H>
        <T weight="semi" size={16} color={colors.white}>this is how a pool works. 3 friends already called it, now you. practice coins, nothing real.</T>

        <View style={styles.card}>
          <View style={styles.potRow}>
            <Coin size={22} />
            <H size={30} color={colors.deep}>{pot}</H>
            <T weight="semi" color={colors.muted}>in the pot · {STAKE} each</T>
          </View>
          {bots.map((b) => (
            <View key={b.name} style={styles.row}>
              <View style={[styles.face, { backgroundColor: b.color }]}><T size={18}>{b.emoji}</T></View>
              <T weight="bold" color={colors.deep} style={{ flex: 1 }}>@{b.name}</T>
              <T weight="bold" color={result && b.pick === result ? colors.win : colors.muted}>{b.pick}{result ? (b.pick === result ? ` +${each}` : ' ✗') : ''}</T>
            </View>
          ))}
          {mine && (
            <View style={styles.row}>
              <View style={[styles.face, { backgroundColor: colors.brand }]}><T size={18}>😎</T></View>
              <T weight="bold" color={colors.deep} style={{ flex: 1 }}>you</T>
              <T weight="bold" color={result ? (won ? colors.win : colors.muted) : colors.brand}>{mine}{result ? (won ? ` +${each}` : ' ✗') : ''}</T>
            </View>
          )}
        </View>

        <View style={styles.coinWrap}>
          <Animated.View style={[styles.coin, { transform: [{ rotateY: turns }] }]}>
            <H size={34} color={colors.deep}>{result ? (result === 'heads' ? 'H' : 'T') : '?'}</H>
          </Animated.View>
        </View>

        {!mine && (
          <View style={styles.choices}>
            {(['heads', 'tails'] as Side[]).map((s) => (
              <Pressable key={s} onPress={() => call(s)} style={({ pressed }) => [styles.choice, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={`call ${s}`}>
                <H size={24} color={colors.royal}>{s}</H>
              </Pressable>
            ))}
          </View>
        )}
        {mine && !result && <T weight="bold" size={16} color={colors.white} style={{ textAlign: 'center' }}>flipping…</T>}
        {result && (
          <View style={{ gap: 12 }}>
            <H size={26} color={won ? colors.yellow : colors.white} style={{ textAlign: 'center' }}>
              {won ? `called it 🔥 +${each} coins` : `${result}. unlucky 😅`}
            </H>
            <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>
              that’s it: everyone calls it, the right calls split the pot. now do it for real with your crew: you start with 50 coins.
            </T>
            <PillButton label="let’s go 👊" variant="white" onPress={onDone} />
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 22, gap: 16 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 10 },
  potRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  face: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  coinWrap: { alignItems: 'center', paddingVertical: 4 },
  coin: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.yellow, borderWidth: 5, borderColor: '#F9C500', alignItems: 'center', justifyContent: 'center' },
  choices: { flexDirection: 'row', gap: 12 },
  choice: { flex: 1, backgroundColor: colors.white, borderRadius: 999, paddingVertical: 18, alignItems: 'center' },
});
