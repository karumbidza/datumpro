import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TaskDetail, TaskPermissions } from '../lib/data/tasks';
import { startTask, submitTask, approveTask, rejectTask } from '../lib/data/task-actions';
import { theme } from '../lib/theme';

type Mode = 'none' | 'submit' | 'reject';

export function TaskActions({
  task,
  perms,
  onChanged,
  planComplete = true,
  acceptancePending = false,
}: {
  task: TaskDetail;
  perms: TaskPermissions;
  onChanged: () => void;
  /** Every subtask ticked — required before "Submit for review". */
  planComplete?: boolean;
  /** Task awaiting the contractor's accept/decline — hide start/submit. */
  acceptancePending?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('none');
  const [notes, setNotes] = useState('');
  const [declared, setDeclared] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setMode('none');
      setNotes('');
      setReason('');
      setDeclared(false);
      onChanged();
    } catch (e) {
      Alert.alert('Action failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const canStart = perms.isAssignee && task.status === 'todo' && !acceptancePending;
  const canSubmit = perms.isAssignee && task.status === 'in_progress' && !acceptancePending;
  const canDecide = perms.canManage && task.status === 'submitted';

  if (!canStart && !canSubmit && !canDecide) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Actions</Text>

      {canStart && (
        <Pressable style={[styles.btn, styles.primary]} disabled={busy} onPress={() => run(() => startTask(task.id, task.orgId))}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Start task</Text>}
        </Pressable>
      )}

      {canSubmit && mode !== 'submit' && planComplete && (
        <Pressable style={[styles.btn, styles.primary]} onPress={() => setMode('submit')}>
          <Text style={styles.primaryText}>Submit for review</Text>
        </Pressable>
      )}
      {canSubmit && mode !== 'submit' && !planComplete && (
        <Text style={styles.hint}>Complete every step in your task plan to submit for review.</Text>
      )}
      {canSubmit && mode === 'submit' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="What was completed? (min 10 characters)"
            placeholderTextColor={theme.color.subtle}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          {task.requiresPhoto && (
            <Text style={styles.hint}>A completion photo is required — add one above before submitting.</Text>
          )}
          <Pressable style={styles.check} onPress={() => setDeclared((d) => !d)}>
            <Ionicons
              name={declared ? 'checkbox' : 'square-outline'}
              size={20}
              color={declared ? theme.color.accent : theme.color.subtle}
            />
            <Text style={styles.checkText}>I confirm this work is complete and accurate.</Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={() => setMode('none')}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, (!declared || notes.trim().length < 10) && styles.disabled]}
              disabled={busy || !declared || notes.trim().length < 10}
              onPress={() =>
                run(() => submitTask({ taskId: task.id, orgId: task.orgId, notes, requiresPhoto: task.requiresPhoto }))
              }
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Submit</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {canDecide && mode !== 'reject' && (
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.success]}
            disabled={busy}
            onPress={() => run(() => approveTask({ taskId: task.id, orgId: task.orgId, dueDate: task.dueDate }))}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Approve</Text>}
          </Pressable>
          <Pressable style={[styles.btn, styles.ghost]} onPress={() => setMode('reject')}>
            <Text style={[styles.ghostText, { color: theme.color.danger }]}>Reject</Text>
          </Pressable>
        </View>
      )}
      {canDecide && mode === 'reject' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Reason for sending back"
            placeholderTextColor={theme.color.subtle}
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={() => setMode('none')}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.danger, !reason.trim() && styles.disabled]}
              disabled={busy || !reason.trim()}
              onPress={() => run(() => rejectTask({ taskId: task.id, orgId: task.orgId, reason }))}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Reject</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
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
  label: { fontSize: 12, color: theme.color.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: { flex: 1, borderRadius: theme.radius.sm, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: theme.color.accent },
  primaryText: { color: '#fff', fontWeight: '700' },
  success: { backgroundColor: theme.color.success },
  danger: { backgroundColor: theme.color.danger },
  ghost: { backgroundColor: '#f1f2f4' },
  ghostText: { color: theme.color.muted, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: 10 },
  form: { gap: 10 },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    padding: 12,
    fontSize: 14,
    color: theme.color.text,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: theme.color.warning },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { flex: 1, fontSize: 13, color: theme.color.muted },
});
