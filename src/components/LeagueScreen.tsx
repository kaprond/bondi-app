import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, ScrollViewInstance, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { DOWN, endsIn, LEAGUE_SIZE, standings, TIERS, UP } from '../league';
import { markLeagueResultSeen, useLeague } from '../leagueState';
import { colors, radius } from '../theme';
import { Avatar } from '../avatar';
import { Coin, H, T } from './ui';

/** This week's league table. */
export function LeagueScreen({ topInset, onClose }: { topInset: number; onClose: () => void }) {
  const lg = useLeague();
  const tier = TIERS[lg.tier];
  const rows = standings({ myWon: lg.myWon, tier: lg.tier, friends: lg.friends });
  const me = rows.find((r) => r.you)!;
  const list = useRef<ScrollViewInstance>(null);
  useEffect(() => { markLeagueResultSeen(); }, []);
  useEffect(() => { const t = setTimeout(() => list.current?.scrollTo({ y: Math.max(me.rank - 4, 0) * 62, animated: true }), 250); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = me.rank <= UP ? 'you’re in the top 5. hold it and you move up.' : me.rank > LEAGUE_SIZE - DOWN ? 'bottom 5 drop a league. a couple of good calls gets you out.' : `${rows[UP - 1].won - me.won + 1} more coins to reach the top 5.`;
  const next = TIERS[Math.min(lg.tier + 1, TIERS.length - 1)];

  return (
    <View style={styles.page}>
      <LinearGradient colors={[colors.sky, colors.brand]} style={[styles.head, { paddingTop: topInset + 12 }]}>
        <View style={styles.top}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="back" style={styles.back}><Ionicons name="chevron-down" size={22} color={colors.deep} /></Pressable>
          <View style={styles.ends}><Ionicons name="time-outline" size={14} color={colors.deep} /><T size={13} weight="bold" color={colors.deep}>ends in {endsIn()}</T></View>
        </View>
        <T size={56}>{tier.emoji}</T>
        <H size={38} color={colors.white}>{tier.name} league</H>
        <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>coins won this week. top {UP} move up{lg.tier < TIERS.length - 1 ? ` to ${next.name}` : ''}, bottom {DOWN} move down.</T>
        <View style={styles.status}><T size={13} weight="bold" color={colors.deep}>#{me.rank} · {status}</T></View>
      </LinearGradient>
      <ScrollView ref={list} contentContainerStyle={{ padding: 14, gap: 6 }}>
        {rows.map((r) => (
          <View key={r.id} style={{ gap: 6 }}>
            {r.rank === LEAGUE_SIZE - DOWN + 1 && <Zone label="drop zone" color={colors.orange} />}
            <View style={[styles.row, r.you && styles.rowMe]}>
              <T weight="bold" size={16} color={r.rank <= UP ? colors.win : r.rank > LEAGUE_SIZE - DOWN ? colors.orange : colors.muted} style={{ width: 28, textAlign: 'center' }}>{r.rank}</T>
              {r.you || r.friend ? <Avatar id={r.id} size={36} /> : <View style={[styles.bot, { backgroundColor: r.color }]}><T size={18}>{r.emoji}</T></View>}
              <View style={{ flex: 1 }}>
                <T weight="bold" color={colors.deep} numberOfLines={1}>{r.name}</T>
                {r.friend && <T size={12} weight="semi" color={colors.brand}>friend</T>}
              </View>
              <View style={styles.coins}><Coin size={14} /><T weight="bold" color={colors.deep}>{r.won.toLocaleString('en')}</T></View>
            </View>
            {r.rank === UP && <Zone label={`top ${UP} move up`} color={colors.win} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Zone({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.zone}>
      <View style={[styles.zoneLine, { backgroundColor: color }]} />
      <T size={11} weight="bold" color={color}>{label}</T>
      <View style={[styles.zoneLine, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.cloud, zIndex: 25 },
  head: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 18, gap: 4, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  top: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  ends: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  status: { marginTop: 8, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  row: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line },
  rowMe: { borderColor: colors.brand, backgroundColor: colors.tint, borderWidth: 2.5 },
  bot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  coins: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  zoneLine: { flex: 1, height: 2, borderRadius: 1, opacity: 0.6 },
});

/** Compact entry point: your tier and rank this week. */
export function LeagueCard({ onPress }: { onPress: () => void }) {
  const lg = useLeague();
  const tier = TIERS[lg.tier];
  const rank = standings({ myWon: lg.myWon, tier: lg.tier, friends: lg.friends }).find((r) => r.you)!.rank;
  return (
    <Pressable onPress={onPress} style={card.wrap} accessibilityRole="button" accessibilityLabel={`${tier.name} league, rank ${rank}`}>
      <View style={[card.badge, { backgroundColor: tier.color }]}><T size={26}>{tier.emoji}</T></View>
      <View style={{ flex: 1 }}>
        <T weight="bold" color={colors.deep}>{tier.name} league · #{rank} of {LEAGUE_SIZE}</T>
        <T size={13} weight="semi" color={colors.muted}>{rank <= UP ? 'in the promotion zone' : `top ${UP} move up`} · ends in {endsIn()}</T>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.brand} />
    </Pressable>
  );
}
const card = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: radius.card, padding: 14, borderWidth: 1.5, borderColor: colors.line },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
