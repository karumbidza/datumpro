import { useState } from 'react';
import { View, Text, Pressable, Modal, Platform, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';

/** 'YYYY-MM-DD' ↔ Date without timezone drift — anchor at local noon so a day
 *  never rolls backwards/forwards when the device is far from UTC. */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Compact date picker button for a step's planned start/end. Clamped to the
 *  parent task's window via min/max so a step can't fall outside its task. */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  min?: string | null;
  max?: string | null;
}) {
  const [iosOpen, setIosOpen] = useState(false);

  const minimumDate = min ? parseISO(min) : undefined;
  const maximumDate = max ? parseISO(max) : undefined;
  // Seed the picker at the current value, else clamp today into the allowed window.
  const seed = value ? parseISO(value) : clampSeed(new Date(), minimumDate, maximumDate);

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: seed,
        mode: 'date',
        minimumDate,
        maximumDate,
        onChange: (e, d) => {
          if (e.type === 'set' && d) onChange(toISO(d));
        },
      });
    } else {
      setIosOpen(true);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.field} onPress={open}>
        <Ionicons name="calendar-outline" size={14} color={theme.color.subtle} />
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value ?? label}
        </Text>
        {value ? (
          <Pressable hitSlop={8} onPress={() => onChange(null)}>
            <Ionicons name="close-circle" size={15} color={theme.color.subtle} />
          </Pressable>
        ) : null}
      </Pressable>

      {Platform.OS === 'ios' && (
        <Modal visible={iosOpen} transparent animationType="fade" onRequestClose={() => setIosOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setIosOpen(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{label} date</Text>
                <Pressable onPress={() => setIosOpen(false)}>
                  <Text style={styles.done}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={seed}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={(_e, d) => {
                  if (d) onChange(toISO(d));
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function clampSeed(d: Date, min?: Date, max?: Date): Date {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: theme.color.card,
  },
  value: { flex: 1, fontSize: 13, color: theme.color.text },
  placeholder: { color: theme.color.subtle },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.card,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: 16,
    paddingBottom: 32,
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: theme.color.text },
  done: { fontSize: 15, fontWeight: '700', color: theme.color.dark },
});
