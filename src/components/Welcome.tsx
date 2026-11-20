import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { H, PillButton, T } from './ui';
import { ART_HERO } from './Blob';
import { useEffect } from 'react';
import { track } from '../track';

export function Welcome({ onAccept, topInset, bottomInset, invitedBy }: { onAccept: () => void; topInset: number; bottomInset: number; invitedBy?: string }) {
  const { width, height } = useWindowDimensions();
  useEffect(() => { track('welcome_seen', { invited: !!invitedBy }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = Math.min(width - 44, 360, height * 0.4);
  // launch: friend pools first, clips come later
  const steps: [keyof typeof Ionicons.glyphMap, string][] = [
    ['help-circle', 'ask anything: who’s late, who caves'],
    ['trophy', 'right calls split the pot'],
  ];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.royal }} contentContainerStyle={[styles.wrap, { paddingTop: topInset + 16, paddingBottom: bottomInset + 24 }]}>
      <Image source={ART_HERO} style={[styles.hero, { width: hero, height: hero }]} accessibilityLabel="letsjam" />
      <View style={{ gap: 8 }}>
        <H size={40} color={colors.white}>call it with{'\n'}your <H size={40} color={colors.yellow}>crew</H></H>
        <T weight="semi" size={17} color={colors.white}>friend pools on anything. free coins, no cash.</T>
      </View>
      {invitedBy && (
        <View style={styles.invite}>
          <T size={22}>🎉</T>
          <View style={{ flex: 1 }}>
            <T weight="bold" color={colors.deepFixed}>@{invitedBy} invited you</T>
            <T size={13} weight="semi" color={colors.deepFixed}>join now and you both get +10 coins</T>
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
        <PillButton label={invitedBy ? "i’m 18+ · let’s go" : "i’m 18+ · play a round"} variant="white" onPress={onAccept} />
        <T size={12} color={colors.white} style={{ textAlign: 'center' }}>coins are free and have no cash value. you can’t buy them or cash them out.</T>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 22, gap: 18, justifyContent: 'space-between' },
  hero: { alignSelf: 'center', borderRadius: 36 },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.yellow, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 12 },
  steps: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
