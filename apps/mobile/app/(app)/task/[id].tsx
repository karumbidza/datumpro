import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getTask, getTaskPermissions, type TaskDetail, type TaskPermissions } from '../../../lib/data/tasks';
import { TaskPhotos } from '../../../components/task-photos';
import { TaskActions } from '../../../components/task-actions';
import { Card, Pill, ProgressBar } from '../../../components/ui';
import { formatDate, slaLabel, statusLabel } from '../../../lib/ui';
import { theme, slaTone, statusProgress, contentWidth } from '../../../lib/theme';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [perms, setPerms] = useState<TaskPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const t = await getTask(String(id));
    setTask(t);
    setPerms(t ? await getTaskPermissions(t.orgId, t.projectId, t.assigneeId) : null);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void load();
      return () => {
        active = false;
      };
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!task) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Task not found or no longer accessible.</Text>
      </View>
    );
  }

  const tone = slaTone(task.slaStatus);
  const pct = statusProgress(task.status);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: task.projectName }} />

      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.badges}>
        <Pill label={slaLabel(task.slaStatus)} tone={tone} />
        <Pill
          label={statusLabel(task.status)}
          tone={{ bg: '#eef0f2', fg: theme.color.muted, bar: theme.color.muted }}
        />
      </View>

      <View style={styles.progressRow}>
        <ProgressBar value={pct} color={tone.bar} />
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      <Pressable style={styles.discussion} onPress={() => router.push(`/(app)/chat/${task.id}`)}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.color.accent} />
        <Text style={styles.discussionText}>Open discussion</Text>
      </Pressable>

      {perms && <TaskActions task={task} perms={perms} onChanged={load} />}

      <Card>
        <Field label="Priority" value={task.priority} />
        <Field label="Due" value={formatDate(task.dueDate)} />
        <Field label="Planned" value={`${formatDate(task.plannedStartDate)} → ${formatDate(task.plannedEndDate)}`} last />
      </Card>

      {task.description ? (
        <Card>
          <Text style={styles.blockLabel}>Description</Text>
          <Text style={styles.body}>{task.description}</Text>
        </Card>
      ) : null}

      <Card>
        <TaskPhotos orgId={task.orgId} projectId={task.projectId} taskId={task.id} />
      </Card>
    </ScrollView>
  );
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: 16, gap: 12, ...contentWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  muted: { color: theme.color.muted },
  title: { fontSize: 22, fontWeight: '800', color: theme.color.text },
  badges: { flexDirection: 'row', gap: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pct: { fontSize: 13, fontWeight: '700', color: theme.color.text, width: 42, textAlign: 'right' },
  discussion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.color.accentSoft,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
  },
  discussionText: { color: theme.color.accent, fontWeight: '700' },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  fieldLabel: { fontSize: 12, color: theme.color.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 14, color: theme.color.text, fontWeight: '500' },
  blockLabel: { fontSize: 12, color: theme.color.subtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  body: { fontSize: 14, color: theme.color.text, lineHeight: 21 },
});
