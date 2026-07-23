import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TaskDetail, TaskPermissions } from '../lib/data/tasks';
import { submitTask, approveTask, rejectTask, raiseBlocker } from '../lib/data/task-actions';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

type Mode = 'none' | 'submit' | 'reject' | 'blocker';

export function TaskActions({
  task,
  perms,
  onChanged,
  planComplete = true,
  acceptancePending = false,
  hasPlan = true,
  planApproved = true,
}: {
  task: TaskDetail;
  perms: TaskPermissions;
  onChanged: () => void;
  /** Every subtask ticked — required before "Submit for review". */
  planComplete?: boolean;
  /** Task awaiting the contractor's accept/decline — hide start/submit. */
  acceptancePending?: boolean;
  /** At least one planned step exists — required before "Start". */
  hasPlan?: boolean;
  /** The priced plan has been approved (or this task doesn't use the plan flow). */
  planApproved?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  // Start moved into the plan panel (top, under the progress bar). Actions now
  // covers only submit / raise-blocker (assignee) and review (manager).
  const canSubmit = perms.isAssignee && task.status === 'in_progress' && !acceptancePending;
  const canDecide = perms.canManage && task.status === 'submitted';

  if (!canSubmit && !canDecide) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Actions</Text>

      {canSubmit && mode === 'none' && planComplete && (
        <Pressable style={[styles.btn, styles.primary]} onPress={() => setMode('submit')}>
          <Text style={styles.primaryText}>Submit for review</Text>
        </Pressable>
      )}
      {canSubmit && mode === 'none' && !planComplete && (
        <Text style={styles.hint}>Complete every step in your task plan to submit for review.</Text>
      )}
      {canSubmit && mode === 'none' && (
        <Pressable style={[styles.btn, styles.danger]} onPress={() => setMode('blocker')}>
          <Text style={styles.primaryText}>Raise a blocker</Text>
        </Pressable>
      )}
      {canSubmit && mode === 'blocker' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="What's blocking you?"
            placeholderTextColor={colors.subtle}
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
              onPress={() => run(() => raiseBlocker(task.id, task.orgId, reason))}
            >
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Raise blocker</Text>}
            </Pressable>
          </View>
        </View>
      )}
      {canSubmit && mode === 'submit' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="What was completed? (min 10 characters)"
            placeholderTextColor={colors.subtle}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Text style={styles.hint}>Attach a photo or document above if you have one — it&apos;s optional.</Text>
          <Pressable style={styles.check} onPress={() => setDeclared((d) => !d)}>
            <Ionicons
              name={declared ? 'checkbox' : 'square-outline'}
              size={20}
              color={declared ? colors.brand : colors.subtle}
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
              onPress={() => run(() => submitTask({ taskId: task.id, orgId: task.orgId, notes }))}
            >
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Submit</Text>}
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
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Approve</Text>}
          </Pressable>
          <Pressable style={[styles.btn, styles.ghost]} onPress={() => setMode('reject')}>
            <Text style={[styles.ghostText, { color: colors.danger }]}>Reject</Text>
          </Pressable>
        </View>
      )}
      {canDecide && mode === 'reject' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Reason for sending back"
            placeholderTextColor={colors.subtle}
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
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Reject</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 10,
    },
    label: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    btn: { flex: 1, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
    primary: { backgroundColor: c.brand },
    primaryText: { color: c.onBrand, fontFamily: font.bodyBold },
    success: { backgroundColor: c.success },
    danger: { backgroundColor: c.danger },
    ghost: { backgroundColor: c.sunk },
    ghostText: { color: c.muted, fontFamily: font.bodyBold },
    disabled: { opacity: 0.5 },
    row: { flexDirection: 'row', gap: 10 },
    form: { gap: 10 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      padding: 12,
      fontSize: 14,
      fontFamily: font.body,
      color: c.text,
      minHeight: 64,
      textAlignVertical: 'top',
    },
    hint: { fontSize: 12, fontFamily: font.body, color: c.accent },
    check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    checkText: { flex: 1, fontSize: 13, fontFamily: font.body, color: c.muted },
  });
