import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { radius, font, type Tone } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        layout.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        scheme === 'light' && layout.cardShadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[layout.pill, { backgroundColor: tone.bg }]}>
      <Text style={[layout.pillText, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={[layout.track, { backgroundColor: colors.sunk }]}>
      <View style={[layout.fill, { width: `${pct}%`, backgroundColor: color ?? colors.brand }]} />
    </View>
  );
}

/** Planned-vs-actual rail: a faint "where it should be" fill (schedule/time),
 *  a solid completion fill on top (green on/ahead, amber when behind), and a
 *  hairline marker at the on-schedule target. Mirrors the web task list. */
export function ScheduleBar({ actual, expected, done }: { actual: number; expected: number | null; done?: boolean }) {
  const { colors } = useTheme();
  const a = Math.max(0, Math.min(100, actual));
  const e = expected == null ? null : Math.max(0, Math.min(100, expected));
  const behind = !done && e != null && a < e - 1;
  const fill = done ? colors.success : behind ? colors.accent : colors.success;
  return (
    <View style={[layout.track, { backgroundColor: colors.sunk }]}>
      {e != null && (
        <View style={[layout.barFill, { width: `${e}%`, backgroundColor: colors.subtle, opacity: 0.35 }]} />
      )}
      <View style={[layout.barFill, { width: `${a}%`, backgroundColor: fill }]} />
      {e != null && e > 0 && e < 100 && (
        <View style={[layout.marker, { left: `${e}%`, backgroundColor: colors.muted }]} />
      )}
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        layout.stat,
        { backgroundColor: colors.surface, borderColor: colors.border },
        scheme === 'light' && layout.cardShadow,
      ]}
    >
      <Text style={[layout.statValue, { color: accent ?? colors.text }]}>{value}</Text>
      <Text style={[layout.statLabel, { color: colors.muted }]}>{label}</Text>
      {hint ? <Text style={[layout.statHint, { color: colors.subtle }]}>{hint}</Text> : null}
    </View>
  );
}

/** Initials avatar (we don't store profile photos yet). */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={[layout.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brand }]}
    >
      <Text style={[layout.avatarText, { fontSize: size * 0.4, color: colors.onBrand }]}>{initials || '?'}</Text>
    </View>
  );
}

/** Uppercase section label (11px, tracked). */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <Text style={[layout.sectionLabel, { color: colors.subtle }, style]}>{children}</Text>;
}

const layout = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
  },
  cardShadow: {
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11, fontFamily: font.bodyBold },
  track: { flex: 1, height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 999 },
  barFill: { position: 'absolute', left: 0, top: 0, height: 8, borderRadius: 999 },
  marker: { position: 'absolute', top: 0, height: 8, width: 1.5, opacity: 0.6 },
  stat: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 14,
    gap: 2,
  },
  statValue: { fontSize: 22, fontFamily: font.displayBold },
  statLabel: { fontSize: 12, fontFamily: font.body },
  statHint: { fontSize: 11, fontFamily: font.body },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bodyBold },
  sectionLabel: {
    fontSize: 11,
    fontFamily: font.bodyBold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
