import { Text, View } from 'react-native';
import { colors } from './theme';
import { person, useSocial } from './social';

/** Round emoji avatar on the person's colour. */
export function Avatar({ id, size = 30, ring = colors.white }: { id: string; name?: string; size?: number; ring?: string }) {
  useSocial();
  const p = person(id);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.color, borderWidth: Math.max(2, size / 22), borderColor: ring, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.68 }}>{p.emoji}</Text>
    </View>
  );
}
