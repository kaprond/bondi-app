import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../avatar';
import { crewList, ME, person, relation, removeFriend, useSocial } from '../social';
import { ReportSheet } from './ReportSheet';
import { colors, radius, shadow } from '../theme';
import { H, PillButton, T } from './ui';
import { RelationButton } from './FriendsScreen';
import { rivalryMood, scoreLine, useRivals } from '../rivals';
import { poolsSnapshot } from './PoolsScreen';
import { track } from '../track';

/** Bottom sheet with a person's public profile. */
export function PersonSheet({ id, onClose, onPoolWith }: { id: string; onClose: () => void; onPoolWith: (id: string) => void }) {
  useSocial();
  const p = person(id);
  const rel = relation(id);
  const [reporting, setReporting] = useState(false);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(y, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 16, stiffness: 180 }).start(); }, [y]);
  const shared = crewList().filter((c) => c.memberIds.includes(id));
  const rival = useRivals(poolsSnapshot).find((r) => r.userId === id);
  const tiles: [string, string][] = [['calls', `${p.stats.calls}`], ['hit rate', `${p.stats.hitRate}%`], ['pools won', `${p.stats.poolsWon}`], ['best streak', `${p.stats.bestStreak}`]];

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: y }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <Avatar id={id} size={84} ring={colors.white} />
          <View style={{ flex: 1, gap: 2 }}>
            <H size={30}>{p.name}</H>
            <T weight="semi" color={colors.muted}>@{p.handle} · {p.city}</T>
            <View style={{ alignSelf: 'flex-start', marginTop: 4 }}><RelationButton id={id} /></View>
          </View>
        </View>
        {!!p.bio && <T weight="semi" color={colors.deep}>“{p.bio}”</T>}
        <View style={styles.grid}>
          {tiles.map(([k, v]) => (
            <View key={k} style={styles.tile}><H size={24} color={colors.deep}>{v}</H><T size={12} weight="semi" color={colors.muted}>{k}</T></View>
          ))}
        </View>
        {rival && id !== ME && (
          <View style={styles.h2h}>
            <T size={11} weight="bold" color={colors.yellow}>⚔️ HEAD TO HEAD</T>
            <View style={styles.h2hRow}>
              <View style={styles.h2hSide}><H size={40} color={colors.white}>{rival.me}</H><T size={12} weight="bold" color={colors.white}>you</T></View>
              <T weight="bold" size={18} color={colors.white}>vs</T>
              <View style={styles.h2hSide}><H size={40} color={colors.white}>{rival.them}</H><T size={12} weight="bold" color={colors.white}>{p.name}</T></View>
            </View>
            <T size={13} weight="semi" color={colors.white} style={{ textAlign: 'center' }}>{rivalryMood(rival)} · pools where you picked opposite sides</T>
          </View>
        )}
        {shared.length > 0 && <T size={13} color={colors.muted}>in your crews: {shared.map((c) => `${c.emoji} ${c.name}`).join(', ')}</T>}
        {rel === 'friend' ? (
          <>
            <PillButton label={rival ? `rematch ${p.name} 🔁` : `start a pool with ${p.name}`} onPress={() => { if (rival) track('rematch'); onPoolWith(id); }} icon={<Ionicons name="dice" size={18} color={colors.white} />} />
            {rival && <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>{scoreLine(rival, p.name)}. pick opposite sides and settle it.</T>}
            <Pressable onPress={() => { removeFriend(id); onClose(); }} style={{ alignSelf: 'center' }} accessibilityRole="button">
              <T size={13} weight="bold" color={colors.muted}>remove friend</T>
            </Pressable>
          </>
        ) : (
          <T size={13} color={colors.muted} style={{ textAlign: 'center' }}>once you’re friends you can add {p.name} to crews and pools.</T>
        )}
        {id !== ME && (
          <Pressable onPress={() => setReporting(true)} style={{ alignSelf: 'center' }} accessibilityRole="button">
            <T size={13} weight="bold" color={colors.muted}>report or block @{p.handle}</T>
          </Pressable>
        )}
      </Animated.View>
      {reporting && <ReportSheet userId={id} onClose={() => setReporting(false)} onBlocked={onClose} />}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 28, gap: 14, ...shadow.soft },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  grid: { flexDirection: 'row', gap: 8 },
  h2h: { backgroundColor: colors.royal, borderRadius: radius.card, padding: 14, gap: 6, alignItems: 'center' },
  h2hRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  h2hSide: { alignItems: 'center' },
  tile: { flex: 1, backgroundColor: colors.cloud, borderRadius: 16, paddingVertical: 10, alignItems: 'center' },
});
