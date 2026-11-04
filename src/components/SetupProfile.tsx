import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '../theme';
import { H, T } from './ui';
import { ProfileEditor } from './ProfileScreen';

/** Onboarding step 2: pick a look and a handle so friends can find you. */
export function SetupProfile({ topInset, onDone }: { topInset: number; onDone: () => void }) {
  return (
    <LinearGradient colors={[colors.brand, colors.sky]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: topInset + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <T weight="bold" color={colors.white}>step 2 of 2</T>
          <Pressable onPress={onDone} accessibilityRole="button" hitSlop={10}><T weight="bold" color={colors.white}>skip</T></Pressable>
        </View>
        <H size={44} color={colors.white}>make it <H size={44} color={colors.yellow}>yours</H></H>
        <T weight="semi" size={16} color={colors.white}>pick a look and a handle so your friends can find you.</T>
        <View style={styles.card}><ProfileEditor onSave={onDone} saveLabel="let’s goooo" /></View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 12, paddingBottom: 40 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  card: { backgroundColor: colors.cloud, borderRadius: radius.sheet, padding: 18, marginTop: 8 },
});
