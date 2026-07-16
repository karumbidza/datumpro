import { useCallback, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getTask, getTaskPermissions, type TaskDetail, type TaskPermissions } from '../../../lib/data/tasks';
import { getTaskConversationId, getUnreadCount } from '../../../lib/data/chat';
import { TaskPhotos } from '../../../components/task-photos';
import { TaskExtensions } from '../../../components/task-extensions';
import { TaskActions } from '../../../components/task-actions';
import { SubtaskPanel } from '../../../components/subtask-panel';
import { listSubtasks, subtaskPct, type Subtask } from '../../../lib/data/subtasks';
import { Card, Pill, ProgressBar } from '../../../components/ui';
import { formatDate, slaLabel, statusLabel } from '../../../lib/ui';
import { theme, slaTone, statusProgress, contentWidth } from '../../../lib/theme';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [perms, setPerms] = useState<TaskPermissions | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const t = await getTask(String(id));
    setTask(t);
    if (!t) {
      setPerms(null);
      setSubtasks([]);
      setUnread(0);
      setLoading(false);
      return;
    }
    // Everything below depends only on the task — fetch it all in parallel
    // instead of one round-trip at a time.
    const [perms, subs, conv] = await Promise.all([
      getTaskPermissions(t.orgId, t.projectId, t.assigneeId),
      listSubtasks(String(id)),
      getTaskConversationId(String(id)),
    ]);
    setPerms(perms);
    setSubtasks(subs);
    setUnread(conv ? await getUnreadCount(conv) : 0);
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
        <BrandLoader />
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
  const acceptancePending = task.acceptanceStatus === 'pending';
  const planComplete = subtasks.length === 0 || subtasks.every((s) => s.isDone);
  const pct =
    task.status === 'done' ? 100 : subtasks.length > 0 ? subtaskPct(subtasks) : statusProgress(task.status);

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
      {(() => {
        if (!task.plannedStartDate || !task.plannedEndDate) return null;
        const s = new Date(task.plannedStartDate).getTime();
        const e = new Date(task.plannedEndDate).getTime();
        if (!(e > s)) return null;
        const elapsed = Math.round(Math.min(100, Math.max(0, ((Date.now() - s) / (e - s)) * 100)));
        const behind = elapsed > pct + 5;
        return (
          <Text style={[styles.elapsed, behind && styles.behind]}>
            {elapsed}% of the timeline elapsed{behind ? ' · behind schedule' : ''}
          </Text>
        );
      })()}

      <Pressable style={styles.discussion} onPress={() => router.push(`/(app)/chat/${task.id}`)}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.color.accent} />
        <Text style={styles.discussionText}>Open discussion</Text>
        {unread > 0 && (
          <View style={styles.unread}>
            <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        )}
      </Pressable>

      {perms && (task.assigneeId || subtasks.length > 0) && (
        <SubtaskPanel
          taskId={task.id}
          orgId={task.orgId}
          subtasks={subtasks}
          acceptanceStatus={task.acceptanceStatus}
          isAssignee={perms.isAssignee}
          canManage={perms.canManage}
          onChanged={load}
        />
      )}

      {perms && (
        <TaskActions
          task={task}
          perms={perms}
          onChanged={load}
          planComplete={planComplete}
          acceptancePending={acceptancePending}
          hasPlan={subtasks.length > 0}
        />
      )}

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

      {perms && (
        <Card>
          <TaskExtensions
            taskId={task.id}
            orgId={task.orgId}
            projectId={task.projectId}
            isAssignee={perms.isAssignee}
            canManage={perms.canManage}
          />
        </Card>
      )}
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
  elapsed: { fontSize: 11, color: theme.color.subtle, marginTop: -4 },
  behind: { color: theme.color.danger, fontWeight: '600' },
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
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
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
