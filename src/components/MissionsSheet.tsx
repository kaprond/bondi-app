import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dayKey, emptyToday, isDone, MISSIONS, progress } from '../missions';
import { useStats } from '../session';
import { colors, radius, shadow } from '../theme';
import { Coin, Eyebrow, H, T } from './ui';

/** Today's missions with progress. Rewards pay out by themselves when a mission is done. */
export function MissionsSheet({ claimed, onClose }: { claimed: string[]; onClose: () => void }) {
  const s = useStats();
  const t = s.today?.day === dayKey() ? s.today : emptyToday();
  const done = MISSIONS.filter((m) => isDone(m, t)).length;
  const total = MISSIONS.reduce((a, m) => a + m.reward, 0);
  return (
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="close missions" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <Eyebrow label={`${done}/${MISSIONS.length} done today`} />
            <H size={28}>today’s missions</H>
            <T size={13} weight="semi" color={colors.muted}>up to {total} extra coins a day. new ones at midnight.</T>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="close"><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 10 }}>
          {MISSIONS.map((m) => {
            const p = progress(m, t), ok = isDone(m, t), paid = claimed.includes(m.id);
            return (
              <View key={m.id} style={[styles.row, ok && styles.rowDone]}>
                <View style={[styles.icon, ok && { backgroundColor: colors.yellow }]}><T size={22}>{ok ? '✅' : m.emoji}</T></View>
                <View style={{ flex: 1, gap: 6 }}>
                  <T weight="bold" color={colors.deep}>{m.label}</T>
                  <View style={styles.track}><View style={[styles.fill, { width: `${(p / m.goal) * 100}%` }, ok && { backgroundColor: colors.win }]} /></View>
                  <T size={12} weight="semi" color={colors.muted}>{ok ? (paid ? 'paid out' : 'paying out…') : `${p} of ${m.goal}`}</T>
                </View>
                <View style={[styles.reward, paid && { backgroundColor: colors.tint }]}>
                  <Coin size={14} /><T weight="bold" size={14} color={colors.deep}>+{m.reward}</T>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>free coins · no cash value</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim, justifyContent: 'flex-end', zIndex: 30 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 16, paddingTop: 8, gap: 12, maxHeight: '85%', ...shadow.soft },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.cloud, borderWidth: 1.5, borderColor: colors.line },
  rowDone: { borderColor: colors.win, backgroundColor: '#E9F8F1' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.brand },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
});
