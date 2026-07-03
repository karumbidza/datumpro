import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import {
  listExtensions,
  requestExtension,
  decideExtension,
  type ExtensionRequest,
} from '../lib/data/extensions';
import { Pill } from './ui';
import { theme, type Tone } from '../lib/theme';

const STATUS: Record<ExtensionRequest['status'], { label: string; tone: Tone }> = {
  pending: {
    label: 'awaiting decision',
    tone: { bg: theme.color.warningSoft, fg: theme.color.warning, bar: theme.color.warning },
  },
  approved: {
    label: 'approved',
    tone: { bg: theme.color.successSoft, fg: theme.color.success, bar: theme.color.success },
  },
  rejected: { label: 'rejected', tone: { bg: '#e5e7eb', fg: '#374151', bar: '#6b7280' } },
  cancelled: { label: 'cancelled', tone: { bg: '#e5e7eb', fg: '#374151', bar: '#6b7280' } },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Extension requests on a task: the assignee proposes a new due date, the PM
 *  approves (which shifts the deadline) or rejects. */
export function TaskExtensions({
  taskId,
  orgId,
  projectId,
  isAssignee,
  canManage,
}: {
  taskId: string;
  orgId: string;
  projectId: string;
  isAssignee: boolean;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<ExtensionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setRows(await listExtensions(taskId));
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPending = rows.some((r) => r.status === 'pending');

  async function submit() {
    if (busy) return;
    if (!DATE_RE.test(date.trim())) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    try {
      await requestExtension({ taskId, orgId, projectId, proposedDueDate: date.trim(), reason });
      setDate('');
      setReason('');
      setShowForm(false);
      await load();
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function decide(r: ExtensionRequest, approve: boolean) {
    Alert.alert(
      approve ? 'Approve extension?' : 'Reject extension?',
      approve ? `The due date will move to ${r.proposedDueDate}.` : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? 'Approve' : 'Reject',
          style: approve ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await decideExtension({ requestId: r.id, taskId, approve });
              await load();
            } catch (e) {
              Alert.alert('Failed', e instanceof Error ? e.message : 'Please try again.');
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return <ActivityIndicator style={{ marginVertical: 8 }} />;
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Extension requests</Text>

      {rows.length === 0 ? (
        <Text style={styles.empty}>None.</Text>
      ) : (
        rows.map((r) => {
          const s = STATUS[r.status];
          return (
            <View key={r.id} style={styles.item}>
              <View style={styles.itemTop}>
                <Text style={styles.date}>New due: {r.proposedDueDate}</Text>
                <Pill label={s.label} tone={s.tone} />
              </View>
              {r.reason ? <Text style={styles.reason}>{r.reason}</Text> : null}
              {r.requesterName ? <Text style={styles.by}>by {r.requesterName}</Text> : null}
              {canManage && r.status === 'pending' && (
                <View style={styles.decideRow}>
                  <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => decide(r, true)}>
                    <Text style={styles.btnPrimaryText}>Approve</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={() => decide(r, false)}>
                    <Text style={[styles.btnText, { color: theme.color.danger }]}>Reject</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })
      )}

      {isAssignee && !hasPending && (
        showForm ? (
          <View style={{ gap: 8, marginTop: 4 }}>
            <TextInput
              style={styles.input}
              placeholder="New due date (YYYY-MM-DD)"
              placeholderTextColor={theme.color.subtle}
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Reason (optional)"
              placeholderTextColor={theme.color.subtle}
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
                <Text style={styles.btnPrimaryText}>{busy ? 'Submitting…' : 'Request extension'}</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => setShowForm(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setShowForm(true)}>
            <Text style={styles.link}>+ Request an extension</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: theme.color.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { fontSize: 14, color: theme.color.muted },
  item: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, padding: 10, gap: 4 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  date: { fontSize: 14, fontWeight: '600', color: theme.color.text },
  reason: { fontSize: 13, color: theme.color.muted },
  by: { fontSize: 12, color: theme.color.subtle },
  decideRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  link: { fontSize: 14, fontWeight: '600', color: theme.color.accent, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.color.text,
  },
  btn: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: theme.color.card,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  btnText: { fontWeight: '700', fontSize: 14, color: theme.color.text },
  btnPrimary: { backgroundColor: theme.color.dark, borderColor: theme.color.dark },
  btnPrimaryText: { color: theme.color.onDark, fontWeight: '700', fontSize: 14 },
});
