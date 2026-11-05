import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { H, PillButton, T, Wordmark } from './ui';

export function Welcome({ onAccept, topInset, bottomInset, invitedBy }: { onAccept: () => void; topInset: number; bottomInset: number; invitedBy?: string }) {
  const steps: [keyof typeof Ionicons.glyphMap, string][] = [
    ['play', 'watch a short clip'],
    ['pause', 'it pauses right before the moment'],
    ['hand-left', 'call what happens next with free coins'],
  ];
  return (
    <LinearGradient colors={[colors.sky, colors.brand]} style={[styles.wrap, { paddingTop: topInset + 24, paddingBottom: bottomInset + 24 }]}>
      <Wordmark size={44} />
      <View style={{ gap: 10 }}>
        <H size={52} color={colors.white}>guess what{'\n'}happens <H size={52} color={colors.yellow}>next</H></H>
        <T weight="semi" size={17} color={colors.white}>short clips, one big question. call it right and stack your coins.</T>
      </View>
      {invitedBy && (
        <View style={styles.invite}>
          <T size={22}>🎉</T>
          <View style={{ flex: 1 }}>
            <T weight="bold" color={colors.deep}>@{invitedBy} invited you</T>
            <T size={13} weight="semi" color={colors.deep}>join now and you both get +500 coins</T>
          </View>
        </View>
      )}
      <View style={styles.steps}>
        {steps.map(([icon, label]) => (
          <View key={label} style={styles.step}>
            <View style={styles.stepIcon}><Ionicons name={icon} size={18} color={colors.brand} /></View>
            <T weight="bold" size={16} color={colors.deep} style={{ flex: 1 }}>{label}</T>
          </View>
        ))}
      </View>
      <View style={{ gap: 12 }}>
        <PillButton label="i’m 18 or older · let’s goooo" variant="white" onPress={onAccept} />
        <T size={12} color={colors.white} style={{ textAlign: 'center' }}>coins are free and have no cash value. you can’t buy them or cash them out.</T>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 22, justifyContent: 'space-between' },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.yellow, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 12 },
  steps: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
