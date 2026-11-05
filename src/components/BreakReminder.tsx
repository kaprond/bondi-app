import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, shadow } from '../theme';
import { H, PillButton, T } from './ui';

/** Shown after 30 minutes of play. Taking a break pauses everything until you come back. */
export function BreakReminder({ onDone }: { onDone: () => void }) {
  const [resting, setResting] = useState(false);
  return (
    <View style={styles.scrim}>
      <View style={styles.card}>
        <T size={48}>{resting ? '🌿' : '⏰'}</T>
        <H size={30} style={{ textAlign: 'center' }}>{resting ? 'enjoy the break' : 'you’ve been calling it for 30 minutes'}</H>
        <T weight="semi" color={colors.muted} style={{ textAlign: 'center' }}>
          {resting ? 'your coins, streak and league spot are safe. come back whenever.' : 'good moment to stretch, grab some water or text a friend. your coins and streak will be right here.'}
        </T>
        {resting ? (
          <PillButton label="i’m back" onPress={onDone} style={{ alignSelf: 'stretch' }} />
        ) : (
          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            <PillButton label="take a break" onPress={() => setResting(true)} />
            <PillButton label="keep playing" variant="ghost" onPress={onDone} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,30,38,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 40 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.white, borderRadius: radius.sheet, padding: 22, gap: 12, alignItems: 'center', ...shadow.soft },
});
