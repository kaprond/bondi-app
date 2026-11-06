import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { H, PillButton, T } from './ui';
import { promptInstall } from '../install';

/** Asked once, after your third call: put bondi on the home screen so it opens full screen. */
export function InstallSheet({ kind, onDone }: { kind: 'prompt' | 'ios'; onDone: (installed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.scrim}>
      <View style={styles.card}>
        <Image source={{ uri: 'icon-192.png' }} style={styles.icon} accessibilityLabel="bondi app icon" />
        <H size={28} style={{ textAlign: 'center' }}>put bondi on your home screen</H>
        <T weight="semi" color={colors.muted} style={{ textAlign: 'center' }}>opens full screen like an app, and your daily coins are one tap away. no app store, nothing to download.</T>
        {kind === 'ios' ? (
          <View style={styles.steps}>
            <View style={styles.step}>
              <View style={styles.num}><T size={13} weight="bold" color={colors.white}>1</T></View>
              <T weight="semi" color={colors.deep} style={{ flexShrink: 1 }}>tap <Ionicons name="share-outline" size={17} color={colors.brand} /> share in Safari’s bar</T>
            </View>
            <View style={styles.step}>
              <View style={styles.num}><T size={13} weight="bold" color={colors.white}>2</T></View>
              <T weight="semi" color={colors.deep} style={{ flexShrink: 1 }}>pick <T weight="bold" color={colors.deep}>add to home screen</T> <Ionicons name="add-circle-outline" size={17} color={colors.brand} /></T>
            </View>
          </View>
        ) : null}
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          {kind === 'prompt'
            ? <PillButton label="add to home screen" busy={busy} onPress={async () => { setBusy(true); try { onDone(await promptInstall()); } finally { setBusy(false); } }} />
            : <PillButton label="got it" onPress={() => onDone(false)} />}
          <Pressable onPress={() => onDone(false)} accessibilityRole="button" style={{ alignSelf: 'center', padding: 6 }}>
            <T size={13} weight="bold" color={colors.muted}>not now</T>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,30,38,0.7)', alignItems: 'center', justifyContent: 'flex-end', padding: 14, zIndex: 35 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.white, borderRadius: radius.sheet, padding: 22, gap: 12, alignItems: 'center', ...shadow.soft },
  icon: { width: 72, height: 72, borderRadius: 18 },
  steps: { alignSelf: 'stretch', gap: 8, backgroundColor: colors.cloud, borderRadius: 16, padding: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
