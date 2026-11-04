import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../avatar';
import { crewList, person, relation, removeFriend, useSocial } from '../social';
import { colors, radius, shadow } from '../theme';
import { H, PillButton, T } from './ui';
import { RelationButton } from './FriendsScreen';

/** Bottom sheet with a person's public profile. */
export function PersonSheet({ id, onClose, onPoolWith }: { id: string; onClose: () => void; onPoolWith: (id: string) => void }) {
  useSocial();
  const p = person(id);
  const rel = relation(id);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(y, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 16, stiffness: 180 }).start(); }, [y]);
  const shared = crewList().filter((c) => c.memberIds.includes(id));
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
        {shared.length > 0 && <T size={13} color={colors.muted}>in your crews: {shared.map((c) => `${c.emoji} ${c.name}`).join(', ')}</T>}
        {rel === 'friend' ? (
          <>
            <PillButton label={`start a pool with ${p.name}`} onPress={() => onPoolWith(id)} icon={<Ionicons name="dice" size={18} color={colors.white} />} />
            <Pressable onPress={() => { removeFriend(id); onClose(); }} style={{ alignSelf: 'center' }} accessibilityRole="button">
              <T size={13} weight="bold" color={colors.muted}>remove friend</T>
            </Pressable>
          </>
        ) : (
          <T size={13} color={colors.muted} style={{ textAlign: 'center' }}>once you’re friends you can add {p.name} to crews and pools.</T>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 28, gap: 14, ...shadow.soft },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  grid: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: colors.cloud, borderRadius: 16, paddingVertical: 10, alignItems: 'center' },
});
