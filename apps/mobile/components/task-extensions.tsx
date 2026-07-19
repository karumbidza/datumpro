import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { listExtensions, requestExtension, type ExtensionRequest } from '../lib/data/extensions';
import { stepsByEntity, myOrgRole, type ApprovalStep } from '../lib/data/approvals';
import { ApprovalChain } from './approval-chain';
import { Pill } from './ui';
import { radius, font, type Colors, type Tone } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

const makeStatus = (c: Colors): Record<ExtensionRequest['status'], { label: string; tone: Tone }> => ({
  pending: {
    label: 'awaiting decision',
    tone: { bg: c.accentSoft, fg: c.accent, bar: c.accent },
  },
  approved: {
    label: 'approved',
    tone: { bg: c.successSoft, fg: c.success, bar: c.success },
  },
  rejected: { label: 'rejected', tone: { bg: c.sunk, fg: c.subtle, bar: c.muted } },
  cancelled: { label: 'cancelled', tone: { bg: c.sunk, fg: c.subtle, bar: c.muted } },
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Extension requests on a task: the assignee proposes a new due date, the PM
 *  approves (which shifts the deadline) or rejects. */
export function TaskExtensions({
  taskId,
  orgId,
  projectId,
  isAssignee,
}: {
  taskId: string;
  orgId: string;
  projectId: string;
  isAssignee: boolean;
  // canManage still accepted from the parent, but decide-eligibility now comes
  // from the viewer's org role via the approval chain.
  canManage?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const STATUS = useMemo(() => makeStatus(colors), [colors]);
  const [rows, setRows] = useState<ExtensionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [steps, setSteps] = useState<Map<string, ApprovalStep[]>>(new Map());
  const [viewerRole, setViewerRole] = useState('');

  const load = useCallback(async () => {
    const list = await listExtensions(taskId);
    setRows(list);
    const [stepMap, role] = await Promise.all([
      stepsByEntity('extension', list.map((r) => r.id)),
      myOrgRole(orgId),
    ]);
    setSteps(stepMap);
    setViewerRole(role ?? '');
    setLoading(false);
  }, [taskId, orgId]);

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
              {r.status === 'pending' && (
                <ApprovalChain steps={steps.get(r.id) ?? []} viewerRole={viewerRole} onDecided={load} />
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
              placeholderTextColor={colors.subtle}
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.subtle}
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

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    label: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    empty: { fontSize: 14, fontFamily: font.body, color: c.muted },
    item: { borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 10, gap: 4 },
    itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    date: { fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    reason: { fontSize: 13, fontFamily: font.body, color: c.muted },
    by: { fontSize: 12, fontFamily: font.body, color: c.subtle },
    decideRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    link: { fontSize: 14, fontFamily: font.bodySemi, color: c.brand, marginTop: 2 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: font.body,
      color: c.text,
    },
    btn: {
      borderRadius: radius.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnText: { fontFamily: font.bodyBold, fontSize: 14, color: c.text },
    btnPrimary: { backgroundColor: c.brand, borderColor: c.brand },
    btnPrimaryText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 14 },
  });
