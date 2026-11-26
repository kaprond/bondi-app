import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE, ensureSession, rpc } from '../backend';
import { track } from '../track';
import { toast } from '../bus';
import { colors, fonts, radius, shadow } from '../theme';
import { Chip, Eyebrow, H, PillButton, T } from './ui';

const KEY = 'letsjam.creatorWaitlist';
const FOLLOWERS = ['<1k', '1k-10k', '10k-100k', '100k+'] as const;

/**
 * Paid creators: coming soon. We pay creators (real money, from LetsJam, as a flat fee per clip)
 * to make clips for the feed. Separate from coins: coins stay free with no cash value.
 * For now this only collects interest (0024_clips_live.sql: creator_waitlist).
 */
export function PaidCreatorsCard() {
  const [joined, setJoined] = useState(false);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [followers, setFollowers] = useState<(typeof FOLLOWERS)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setJoined(v === '1')).catch(() => {}); }, []);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (LIVE) { await ensureSession(); await rpc('join_creator_waitlist', { p_handle: handle, p_followers: followers }); }
      await AsyncStorage.setItem(KEY, '1');
      track('creator_waitlist', { followers: followers ?? 'unknown' });
      setJoined(true); setOpen(false);
      toast('you’re on the list 🎬 we’ll reach out');
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Eyebrow label="paid creators" />
        <View style={styles.soon}><T size={11} weight="bold" color={colors.deepFixed}>coming soon</T></View>
      </View>
      <H size={22} color={colors.deep}>get paid to make clips 💸</H>
      <T color={colors.muted}>we’re lining up creators to film “will it happen?” clips for the feed. you get a flat fee per clip from us, plus your name on every call. real money for the work, not coins.</T>
      {joined ? (
        <T weight="bold" color={colors.brand}>✓ you’re on the waitlist. we’ll message you when it opens.</T>
      ) : open ? (
        <View style={{ gap: 10 }}>
          <TextInput value={handle} onChangeText={setHandle} placeholder="your @ on tiktok / instagram" placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false} maxLength={60} style={styles.input} accessibilityLabel="your social handle" />
          <T size={13} color={colors.muted}>followers</T>
          <View style={styles.wrap}>{FOLLOWERS.map((f) => <Chip key={f} label={f} active={followers === f} onPress={() => setFollowers(f)} />)}</View>
          <PillButton label={busy ? 'joining…' : 'join the waitlist'} onPress={join} />
        </View>
      ) : (
        <PillButton label="join the waitlist" variant="ghost" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 10, ...shadow.soft },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  soon: { backgroundColor: colors.yellow, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { backgroundColor: colors.cloud, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.deep },
});
