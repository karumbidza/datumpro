import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { MyTask } from '../lib/data/tasks';
import { Pill, ScheduleBar } from './ui';
import { formatDate, slaLabel, statusLabel } from '../lib/ui';
import { slaTone, radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

/** ACTUAL completion — real work, never time-based. Done/submitted = 100, else the
 *  ticked share of the plan; no plan reads 0 until steps are ticked. */
function actualPct(task: MyTask, progress?: { done: number; total: number }): number {
  if (task.status === 'done') return 100;
  if (progress && progress.total > 0) return Math.round((100 * progress.done) / progress.total);
  if (task.status === 'submitted') return 100;
  return 0;
}

/** EXPECTED position — how far into the planned window "now" sits (the faint bar);
 *  null when there's no window to measure against or the task is done. */
function expectedPct(task: MyTask): number | null {
  if (task.status === 'done') return null;
  const s = task.plannedStartDate ? new Date(task.plannedStartDate).getTime() : null;
  const e = (task.plannedEndDate ?? task.dueDate) ? new Date((task.plannedEndDate ?? task.dueDate) as string).getTime() : null;
  if (s == null || e == null || e <= s) return null;
  return Math.round(Math.min(1, Math.max(0, (Date.now() - s) / (e - s))) * 100);
}

function statusIcon(status: string): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'done':
      return 'checkmark-done';
    case 'submitted':
      return 'hourglass-outline';
    case 'blocked':
      return 'alert-circle-outline';
    case 'in_progress':
      return 'construct-outline';
    default:
      return 'ellipse-outline';
  }
}

/** Task summary card — tap to open the task. `subtitle` defaults to the project
 *  name (handy in the Tasks tab); pass a custom one when the project is obvious. */
export function TaskCard({
  task,
  subtitle,
  progress,
}: {
  task: MyTask;
  subtitle?: string;
  progress?: { done: number; total: number };
}) {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tone = slaTone(colors, task.slaStatus);
  const pending = task.acceptanceStatus === 'pending';
  const pct = pending ? 0 : actualPct(task, progress);
  const expected = pending ? null : expectedPct(task);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, scheme === 'light' && styles.shadow, pressed && styles.pressed]}
      onPress={() => router.push(`/(app)/task/${task.id}`)}
    >
      {pending && (
        <View style={styles.acceptBanner}>
          <Ionicons name="alert-circle" size={14} color={colors.accentDeep} />
          <Text style={styles.acceptText}>Awaiting your acceptance — tap to accept or decline</Text>
        </View>
      )}
      <View style={styles.top}>
        <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
          <Ionicons name={statusIcon(task.status)} size={18} color={tone.fg} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle ?? task.projectName}
          </Text>
        </View>
        <Pill label={slaLabel(task.slaStatus)} tone={tone} />
      </View>

      <View style={styles.progress}>
        <ScheduleBar actual={pct} expected={expected} done={task.status === 'done'} />
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      <View style={styles.meta}>
        <Ionicons name="calendar-outline" size={13} color={colors.subtle} />
        <Text style={styles.metaText}>Due {formatDate(task.dueDate)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{statusLabel(task.status)}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 11,
    },
    shadow: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    pressed: { opacity: 0.85 },
    acceptBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.accentSoft,
      borderRadius: radius.sm,
      paddingVertical: 7,
      paddingHorizontal: 10,
    },
    acceptText: { flex: 1, fontSize: 12, fontFamily: font.bodyBold, color: c.accentDeep },
    top: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    title: { fontSize: 15, fontFamily: font.bodyBold, color: c.text },
    sub: { fontSize: 12, fontFamily: font.body, color: c.subtle, marginTop: 1 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    metaText: { fontSize: 12, fontFamily: font.body, color: c.muted },
    metaDot: { color: c.subtle },
    progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pct: { fontSize: 13, fontFamily: font.display, color: c.text, width: 40, textAlign: 'right' },
  });
