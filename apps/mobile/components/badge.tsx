import { Text, View, StyleSheet } from 'react-native';
import type { Tone } from '../lib/ui';

export function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 11, fontWeight: '600' },
});
