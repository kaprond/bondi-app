import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow } from '../theme';
import { FeedClip, Side, Stake, STAKES } from '../types';
import { Chip, Coin, Eyebrow, H, PillButton, T } from './ui';

interface Props {
  clip: FeedClip;
  balance: number;
  onPlace: (choice: Side, stake: Stake) => Promise<void>;
}

const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync(); };

export function BetSheet({ clip, balance, onPlace }: Props) {
  const [choice, setChoice] = useState<Side | null>(null);
  const [stake, setStake] = useState<Stake>(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(rise, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 16, stiffness: 160 }).start();
  }, [rise]);

  const odds = choice === 'a' ? clip.oddsA : choice === 'b' ? clip.oddsB : null;
  const returns = odds ? Math.floor(stake * odds) : null;
  const short = stake > balance;

  async function place() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await onPlace(choice, stake); } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const option = (side: Side, label: string, o: number, icon: keyof typeof Ionicons.glyphMap) => {
    const on = choice === side;
    return (
      <Pressable key={side} onPress={() => { tap(); setChoice(side); }}
        accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${label}, pays ${o} times`}
        style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { transform: [{ scale: 0.98 }] }]}>
        <View style={[styles.optionIcon, on && { backgroundColor: colors.brand }]}>
          <Ionicons name={on ? 'checkmark' : icon} size={18} color={on ? colors.white : colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T weight="bold" size={15} color={colors.deep} numberOfLines={2}>{label}</T>
          <View style={[styles.odds, on && { backgroundColor: colors.yellow }]}>
            <T weight="bold" size={13} color={colors.deep}>{o.toFixed(2)}×</T>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Animated.View style={[styles.sheet, { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }], opacity: rise }]}>
      <View style={styles.grabber} />
      <View style={styles.head}>
        <Eyebrow label="paused · your call" />
        <H size={26}>{clip.question}</H>
      </View>
      <View style={styles.row}>
        {option('a', clip.labelA, clip.oddsA, 'thumbs-up')}
        {option('b', clip.labelB, clip.oddsB, 'thumbs-down')}
      </View>

      <View style={styles.stakeRow}>
        <View style={styles.inline}><Coin size={14} /><T weight="semi" size={13} color={colors.muted}>stake</T></View>
        {STAKES.map((s) => <Chip key={s} label={`${s}`} active={stake === s} disabled={s > balance} onPress={() => { tap(); setStake(s); }} />)}
      </View>

      {error && <T color={colors.orange} weight="semi" style={{ textAlign: 'center' }}>{error}</T>}
      <PillButton label={short ? 'not enough coins' : choice && returns ? `lock it in · win ${returns}` : 'pick what happens next'}
        onPress={place} disabled={!choice || short} busy={busy}
        icon={choice && !short ? <Ionicons name="lock-closed" size={16} color={colors.white} /> : undefined} />
      <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>free coins · no cash value · outcome locked before upload</T>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10, ...shadow.soft },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line },
  head: { gap: 4 },
  row: { flexDirection: 'row', gap: 10 },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.cloud },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.tint },
  optionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  odds: { alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 1 },
  stakeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

