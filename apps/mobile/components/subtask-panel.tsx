import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, ProgressBar } from './ui';
import { theme } from '../lib/theme';
import {
  acceptTask,
  declineTask,
  addSubtask,
  toggleSubtask,
  removeSubtask,
  subtaskPct,
  type Subtask,
} from '../lib/data/subtasks';

export function SubtaskPanel({
  taskId,
  orgId,
  subtasks,
  acceptanceStatus,
  isAssignee,
  canManage,
  onChanged,
}: {
  taskId: string;
  orgId: string;
  subtasks: Subtask[];
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  isAssignee: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const canEdit = isAssignee || canManage;
  const pct = subtaskPct(subtasks);
  const done = subtasks.filter((s) => s.isDone).length;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Acceptance decision for the assigned contractor.
  if (acceptanceStatus === 'pending' && isAssignee) {
    return (
      <Card>
        <Text style={styles.title}>Accept this task?</Text>
        <Text style={styles.hint}>Accept to start planning your work, or decline to send it back to the PM.</Text>
        {!declineOpen ? (
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnPrimary]} disabled={busy} onPress={() => run(() => acceptTask(taskId))}>
              <Text style={styles.btnPrimaryText}>Accept task</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => setDeclineOpen(true)}>
              <Text style={styles.btnOutlineText}>Decline</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (shared with the PM)"
              placeholderTextColor={theme.color.subtle}
              style={styles.input}
              multiline
            />
            <View style={styles.row}>
              <Pressable
                style={[styles.btn, styles.btnDanger]}
                disabled={busy}
                onPress={() => run(() => declineTask(taskId, reason.trim()))}
              >
                <Text style={styles.btnPrimaryText}>Decline task</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => setDeclineOpen(false)}>
                <Text style={styles.btnOutlineText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Task plan</Text>
        <Text style={styles.count}>
          {done}/{subtasks.length} · {pct}%
        </Text>
      </View>

      {acceptanceStatus === 'pending' && !isAssignee && (
        <Text style={styles.pending}>Waiting for the contractor to accept.</Text>
      )}

      <View style={styles.progressRow}>
        <ProgressBar value={pct} color={theme.color.accent} />
      </View>

      <View style={styles.list}>
        {subtasks.map((s) => (
          <View key={s.id} style={styles.item}>
            <Pressable
              disabled={!canEdit || busy}
              onPress={() => run(() => toggleSubtask(s.id, !s.isDone))}
              hitSlop={8}
            >
              <Ionicons
                name={s.isDone ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={s.isDone ? theme.color.success : theme.color.subtle}
              />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, s.isDone && styles.itemDone]}>{s.title}</Text>
              {(s.plannedStartDate || s.plannedEndDate) && (
                <Text style={styles.itemDates}>
                  {s.plannedStartDate ?? '—'} → {s.plannedEndDate ?? '—'}
                </Text>
              )}
            </View>
            {canEdit && (
              <Pressable disabled={busy} onPress={() => run(() => removeSubtask(s.id))} hitSlop={8}>
                <Ionicons name="close" size={18} color={theme.color.subtle} />
              </Pressable>
            )}
          </View>
        ))}
        {subtasks.length === 0 && (
          <Text style={styles.empty}>{canEdit ? 'Break the task into steps below.' : 'No plan yet.'}</Text>
        )}
      </View>

      {canEdit && acceptanceStatus !== 'pending' && (
        <View style={styles.addRow}>
          <TextInput
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Add a step…"
            placeholderTextColor={theme.color.subtle}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            style={[styles.addBtn, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
            disabled={!newTitle.trim() || busy}
            onPress={() =>
              run(async () => {
                await addSubtask({ taskId, orgId, title: newTitle.trim() });
                setNewTitle('');
              })
            }
          >
            {busy ? <ActivityIndicator color={theme.color.onDark} /> : <Text style={styles.addBtnText}>Add</Text>}
          </Pressable>
        </View>
      )}

      {canEdit && subtasks.length > 0 && done < subtasks.length && (
        <Text style={styles.gateHint}>Tick every step to unlock Submit for sign-off.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '800', color: theme.color.text },
  hint: { fontSize: 13, color: theme.color.muted, marginTop: 4, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 12, fontWeight: '700', color: theme.color.muted },
  pending: { fontSize: 13, color: theme.color.warning, marginTop: 4 },
  progressRow: { marginTop: 10 },
  list: { marginTop: 10, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { fontSize: 14, color: theme.color.text },
  itemDone: { color: theme.color.subtle, textDecorationLine: 'line-through' },
  itemDates: { fontSize: 11, color: theme.color.subtle, marginTop: 1 },
  empty: { fontSize: 13, color: theme.color.subtle, paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { flex: 1, borderRadius: theme.radius.md, paddingVertical: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.color.accent },
  btnPrimaryText: { color: theme.color.onDark, fontWeight: '700' },
  btnDanger: { backgroundColor: theme.color.danger },
  btnOutline: { borderWidth: 1, borderColor: theme.color.border },
  btnOutlineText: { color: theme.color.text, fontWeight: '600' },
  input: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.color.text,
  },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  addBtn: { backgroundColor: theme.color.dark, borderRadius: theme.radius.md, paddingHorizontal: 18, paddingVertical: 11 },
  addBtnText: { color: theme.color.onDark, fontWeight: '700' },
  gateHint: { fontSize: 11, color: theme.color.subtle, marginTop: 8 },
});
