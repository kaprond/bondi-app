import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow } from '../theme';
import { BetResult, FeedClip } from '../types';
import { Coin, H, PillButton, T } from './ui';
import { Confetti } from './Confetti';
import { CountUp } from './CountUp';
import { shareText } from '../share';
import { friendCalls, INVITE_CODE, inviteLink, nameOf } from '../social';
import { Avatar } from '../avatar';

interface Props { clip: FeedClip; result: BetResult; stake: number; streak: number; onNext: () => void; onReplay: () => void }

export function ResultOverlay({ clip, result, stake, streak, onNext, onReplay }: Props) {
  const pop = useRef(new Animated.Value(0)).current;
  const [proof, setProof] = useState(false);
  const label = result.outcome === 'a' ? clip.labelA : clip.labelB;
  const net = result.payout - stake;
  const crowd = result.outcome === 'a' ? clip.crowdA : 100 - clip.crowdA;
  const fc = friendCalls(clip.id, clip.crowdA);
  const right = fc.filter((f) => f.side === result.outcome);
  const wrong = fc.filter((f) => f.side !== result.outcome);
  const names = (xs: { id: string }[]) => xs.length === 1 ? nameOf(xs[0].id) : `${xs.slice(0, -1).map((x) => nameOf(x.id)).join(', ')} and ${nameOf(xs[xs.length - 1].id)}`;
  const friendLine = !fc.length ? null : !right.length ? `none of your friends saw that coming` : !wrong.length ? `${names(right)} called it too` : `${names(right)} called it. ${names(wrong)} didn’t`;
  const crowdLine = crowd < 40 ? `only ${crowd}% saw that coming` : `${crowd}% of players called it`;

  useEffect(() => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(result.won ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    Animated.spring(pop, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 11, stiffness: 180 }).start();
  }, [pop, result.won]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  return (
    <>
    {result.won && <Confetti />}
    <Animated.View style={[styles.wrap, { opacity: pop, transform: [{ scale }] }]}>
      <LinearGradient colors={result.won ? [colors.brand, colors.deep] : ['#FFFFFF', colors.cloud]} style={styles.card}>
        <View style={[styles.badge, { backgroundColor: result.won ? colors.yellow : colors.tint }]}>
          <Ionicons name={result.won ? 'trophy' : 'refresh'} size={22} color={colors.deep} />
        </View>
        <H size={34} color={result.won ? colors.white : colors.deep} style={{ textAlign: 'center' }}>
          {result.won ? 'called it!' : 'so close'}
        </H>
        <T weight="semi" color={result.won ? colors.white : colors.muted} style={{ textAlign: 'center' }}>it was “{label}”</T>
        <View style={styles.amount}>
          <Coin size={26} />
          <CountUp to={net} size={44} color={result.won ? colors.yellow : colors.orange} />
        </View>
        <View style={[styles.crowd, { backgroundColor: result.won ? 'rgba(255,255,255,0.16)' : colors.tint }]}>
          <Ionicons name="people" size={14} color={result.won ? colors.white : colors.deep} />
          <T size={13} weight="bold" color={result.won ? colors.white : colors.deep}>{crowdLine}</T>
        </View>
        {friendLine && (
          <View style={styles.friendRow}>
            <View style={{ flexDirection: 'row' }}>{fc.slice(0, 4).map((f, i) => (
              <View key={f.id} style={{ marginLeft: i ? -6 : 0, opacity: f.side === result.outcome ? 1 : 0.45 }}><Avatar id={f.id} size={22} /></View>
            ))}</View>
            <T size={13} weight="semi" color={result.won ? colors.white : colors.deep} style={{ flexShrink: 1 }}>{friendLine}</T>
          </View>
        )}
        {result.won && streak > 1 && (
          <View style={styles.streak}><T weight="bold" color={colors.deep}>🔥 {streak} in a row</T></View>
        )}
        <PillButton label="next clip" variant={result.won ? 'white' : 'brand'} onPress={onNext} style={{ alignSelf: 'stretch' }}
          icon={<Ionicons name="arrow-down" size={18} color={result.won ? colors.brand : colors.white} />} />
        <View style={styles.links}>
          <Pressable onPress={onReplay} accessibilityRole="button"><T weight="bold" size={14} color={result.won ? colors.white : colors.brand}>watch again</T></Pressable>
          {result.won && (
            <Pressable onPress={() => shareText(`called it on bondi: “${clip.title}” went “${label}”. +${net} coins. bet you can’t. code ${INVITE_CODE}`, inviteLink)} accessibilityRole="button">
              <T weight="bold" size={14} color={colors.white}>brag</T>
            </Pressable>
          )}
          <Pressable onPress={() => setProof((p) => !p)} accessibilityRole="button"><T weight="bold" size={14} color={result.won ? colors.white : colors.brand}>{proof ? 'hide proof' : 'check it was fair'}</T></Pressable>
        </View>
        {proof && (
          <View style={styles.proof}>
            <T size={12} color={colors.deep} weight="semi">outcome hash published before upload:</T>
            <T size={11} color={colors.deep} style={styles.mono}>{clip.commitHash}</T>
            <T size={12} color={colors.deep} weight="semi">sha256("{clip.id}|{result.outcome}|{result.salt}") gives the same hash, so we could not change the result after you bet.</T>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, bottom: 16 },
  card: { borderRadius: radius.sheet, padding: 20, gap: 10, alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', ...shadow.soft },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streak: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 4 },
  crowd: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  links: { flexDirection: 'row', gap: 24 },
  proof: { alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 14, padding: 12, gap: 4 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
});
