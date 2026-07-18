import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getTask, getTaskPermissions, type TaskDetail, type TaskPermissions } from '../../../lib/data/tasks';
import { getTaskConversationId, getUnreadCount } from '../../../lib/data/chat';
import { TaskPhotos } from '../../../components/task-photos';
import { TaskExtensions } from '../../../components/task-extensions';
import { TaskActions } from '../../../components/task-actions';
import { SubtaskPanel } from '../../../components/subtask-panel';
import { listSubtasks, subtaskPct, type Subtask } from '../../../lib/data/subtasks';
import { listSubtaskPhotos, type TaskPhoto } from '../../../lib/data/media';
import { Card, Pill, ScheduleBar } from '../../../components/ui';
import { formatDate, slaLabel, statusLabel } from '../../../lib/ui';
import { slaTone, contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [perms, setPerms] = useState<TaskPermissions | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtaskMedia, setSubtaskMedia] = useState<Record<string, TaskPhoto[]>>({});
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
    const [perms, subs, media, conv] = await Promise.all([
      getTaskPermissions(t.orgId, t.projectId, t.assigneeId),
      listSubtasks(String(id)),
      listSubtaskPhotos(String(id)),
      getTaskConversationId(String(id)),
    ]);
    setPerms(perms);
    setSubtasks(subs);
    setSubtaskMedia(media);
    setUnread(conv ? await getUnreadCount(conv) : 0);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
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

  const tone = slaTone(colors, task.slaStatus);
  const acceptancePending = task.acceptanceStatus === 'pending';
  const planComplete = subtasks.length === 0 || subtasks.every((s) => s.isDone);
  // ACTUAL completion — real work only (never time-based).
  const pct = acceptancePending
    ? 0
    : task.status === 'done'
      ? 100
      : subtasks.length > 0
        ? subtaskPct(subtasks)
        : task.status === 'submitted'
          ? 100
          : 0;
  // EXPECTED position — how far into the planned window "now" sits (the faint bar).
  const expected = (() => {
    if (acceptancePending || task.status === 'done' || !task.plannedStartDate || !task.plannedEndDate) return null;
    const s = new Date(task.plannedStartDate).getTime();
    const e = new Date(task.plannedEndDate).getTime();
    if (!(e > s)) return null;
    return Math.round(Math.min(100, Math.max(0, ((Date.now() - s) / (e - s)) * 100)));
  })();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: task.projectName,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />

      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.badges}>
        <Pill label={slaLabel(task.slaStatus)} tone={tone} />
        <Pill label={statusLabel(task.status)} tone={{ bg: colors.sunk, fg: colors.muted, bar: colors.muted }} />
      </View>

      <View style={styles.progressRow}>
        <ScheduleBar actual={pct} expected={expected} done={task.status === 'done'} />
        <Text style={styles.pct}>{pct}%</Text>
      </View>
      {(() => {
        if (expected == null) return null;
        const behind = pct < expected - 1;
        return (
          <Text style={[styles.elapsed, behind && styles.behind]}>
            {expected}% of the timeline elapsed{behind ? ' · behind schedule' : ''}
          </Text>
        );
      })()}

      <Pressable style={styles.discussion} onPress={() => router.push(`/(app)/chat/${task.id}`)}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.brandDeep} />
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
          projectId={task.projectId}
          subtasks={subtasks}
          mediaBySubtask={subtaskMedia}
          acceptanceStatus={task.acceptanceStatus}
          isAssignee={perms.isAssignee}
          canManage={perms.canManage}
          taskStatus={task.status}
          taskStart={task.plannedStartDate}
          taskEnd={task.plannedEndDate}
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.fieldRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 12, ...contentWidth },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
    muted: { color: c.muted, fontFamily: font.body },
    title: { fontSize: 23, fontFamily: font.displayBold, color: c.text },
    badges: { flexDirection: 'row', gap: 8 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pct: { fontSize: 13, fontFamily: font.display, color: c.text, width: 42, textAlign: 'right' },
    elapsed: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: -4 },
    behind: { color: c.danger, fontFamily: font.bodySemi },
    discussion: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.brandSoft,
      borderRadius: radius.md,
      paddingVertical: 14,
    },
    discussionText: { color: c.brandDeep, fontFamily: font.bodyBold },
    unread: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadText: { color: c.onAccent, fontSize: 11, fontFamily: font.bodyBold },
    fieldRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    fieldLabel: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    fieldValue: { fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    blockLabel: {
      fontSize: 12,
      fontFamily: font.bodyBold,
      color: c.subtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    body: { fontSize: 14, fontFamily: font.body, color: c.text, lineHeight: 21 },
  });
