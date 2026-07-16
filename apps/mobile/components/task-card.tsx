import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { MyTask } from '../lib/data/tasks';
import { Pill, ProgressBar } from './ui';
import { formatDate, slaLabel, statusLabel } from '../lib/ui';
import { theme, slaTone, statusProgress } from '../lib/theme';

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
export function TaskCard({ task, subtitle }: { task: MyTask; subtitle?: string }) {
  const router = useRouter();
  const tone = slaTone(task.slaStatus);
  const pending = task.acceptanceStatus === 'pending';
  const pct = pending ? 0 : statusProgress(task.status);

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/(app)/task/${task.id}`)}>
      {pending && (
        <View style={styles.acceptBanner}>
          <Ionicons name="alert-circle" size={14} color={theme.color.warning} />
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

      <View style={styles.meta}>
        <Ionicons name="calendar-outline" size={13} color={theme.color.subtle} />
        <Text style={styles.metaText}>due {formatDate(task.dueDate)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{statusLabel(task.status)}</Text>
      </View>

      <View style={styles.progress}>
        <ProgressBar value={pct} color={tone.bar} />
        <Text style={styles.pct}>{pct}%</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 14,
    gap: 10,
  },
  acceptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.color.warningSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  acceptText: { flex: 1, fontSize: 12, fontWeight: '700', color: theme.color.warning },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700', color: theme.color.text },
  sub: { fontSize: 12, color: theme.color.subtle, marginTop: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: theme.color.muted },
  metaDot: { color: theme.color.subtle },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pct: { fontSize: 12, fontWeight: '700', color: theme.color.text, width: 38, textAlign: 'right' },
});
