import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nameOf, person } from '../social';
import { blockUser, isBlocked, report, REPORT_REASONS } from '../safety';
import { colors, radius, shadow } from '../theme';
import { Chip, H, PillButton, T } from './ui';

/** Report a pool or a person, and optionally block them. Opened from a pool or a profile. */
export function ReportSheet({ poolId, userId, onClose, onBlocked }: { poolId?: string; userId?: string; onClose: () => void; onBlocked?: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(y, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 16, stiffness: 180 }).start(); }, [y]);
  const who = userId ? `@${person(userId).handle}` : undefined;
  const canBlock = !!userId && !isBlocked(userId);

  async function send() {
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      await report({ poolId, userId, reason });
      if (alsoBlock && userId) { await blockUser(userId); onBlocked?.(); }
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  async function blockOnly() {
    if (!userId) return;
    setBusy(true);
    await blockUser(userId);
    onBlocked?.();
    onClose();
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: y }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] }]}>
        <View style={styles.grab} />
        <H size={28}>{poolId ? 'report this pool' : `report ${userId ? nameOf(userId) : ''}`}</H>
        <T size={13} color={colors.muted}>a real person checks every report within 24 hours. {who ? `${who} won’t know it was you.` : ''}</T>
        <View style={styles.wrap}>
          {REPORT_REASONS.map((r) => <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />)}
        </View>
        {canBlock && (
          <Pressable onPress={() => setAlsoBlock((b) => !b)} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked: alsoBlock }}>
            <Ionicons name={alsoBlock ? 'checkbox' : 'square-outline'} size={22} color={colors.brand} />
            <T weight="semi" color={colors.deep} style={{ flex: 1 }}>also block {who}: they can’t find or friend you, and you won’t see their pools</T>
          </Pressable>
        )}
        {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
        <PillButton label="send report" onPress={send} disabled={!reason} busy={busy} />
        {canBlock && (
          <Pressable onPress={blockOnly} disabled={busy} style={{ alignSelf: 'center' }} accessibilityRole="button">
            <T size={13} weight="bold" color={colors.orange}>just block {who}</T>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 28, gap: 12, ...shadow.soft },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cloud, borderRadius: 16, padding: 12 },
});
