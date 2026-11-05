import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { Coin, T, Wordmark } from './ui';

export type BarTone = 'media' | 'light';
export type RenderBar = (tone: BarTone) => React.ReactNode;

export function TopBar({ tone, topInset, balance, streak, onCoins }: { tone: BarTone; topInset: number; balance: number; streak: number; onCoins: () => void }) {
  return (
    <View style={[styles.bar, { paddingTop: topInset + 8 }]} pointerEvents="box-none">
      <Wordmark size={32} color={tone === 'light' ? colors.brand : colors.white} />
      <View style={styles.right}>
        {streak > 0 && <View style={styles.streak}><T weight="bold" size={14} color={colors.deep}>🔥 {streak}</T></View>}
        <Pressable style={[styles.coins, tone === 'light' && styles.coinsLight]} onPress={onCoins} accessibilityRole="button" accessibilityLabel={`${balance} coins, open profile`}>
          <Coin size={18} />
          <T weight="bold" size={16} color={colors.deep}>{balance}</T>
          <View style={styles.plus}><Ionicons name="add" size={14} color={colors.white} /></View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streak: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  coins: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white, borderRadius: radius.pill, paddingLeft: 10, paddingRight: 5, paddingVertical: 5 },
  coinsLight: { borderWidth: 1.5, borderColor: colors.line },
  plus: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
