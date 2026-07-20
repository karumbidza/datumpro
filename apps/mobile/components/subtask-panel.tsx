import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { formatUsd } from '@datumpro/shared/domain';
import { Card, ProgressBar } from './ui';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import {
  acceptTask,
  declineTask,
  returnTask,
  addSubtask,
  updateSubtask,
  toggleSubtask,
  removeSubtask,
  submitPlan,
  subtaskPct,
  isCounted,
  type Subtask,
} from '../lib/data/subtasks';
import { ApprovalChain } from './approval-chain';
import type { ApprovalStep } from '../lib/data/approvals';
import { uploadTaskPhoto, type TaskPhoto } from '../lib/data/media';
import { DateField } from './date-field';

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function SubtaskPanel({
  taskId,
  orgId,
  projectId,
  subtasks,
  mediaBySubtask,
  acceptanceStatus,
  isAssignee,
  taskStatus,
  taskStart,
  taskEnd,
  planSubmittedAt,
  planApprovedAt,
  awardedCostCents,
  planSteps,
  viewerRole,
  onChanged,
}: {
  taskId: string;
  orgId: string;
  projectId: string;
  subtasks: Subtask[];
  mediaBySubtask: Record<string, TaskPhoto[]>;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  isAssignee: boolean;
  canManage: boolean;
  taskStatus: string;
  /** The parent task's window — step dates are clamped to it. */
  taskStart: string | null;
  taskEnd: string | null;
  planSubmittedAt: string | null;
  planApprovedAt: string | null;
  awardedCostCents: number | null;
  planSteps: ApprovalStep[];
  viewerRole: string;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Add-a-step draft inputs (priced plan).
  const [newTitle, setNewTitle] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState<'hours' | 'days'>('days');
  const [newStart, setNewStart] = useState<string | null>(null);
  const [newEnd, setNewEnd] = useState<string | null>(null);
  const [newCost, setNewCost] = useState('');

  const baseline = subtasks.filter((s) => !s.isVariation);
  const counted = subtasks.filter(isCounted);
  const done = counted.filter((s) => s.isDone).length;
  const pct = subtaskPct(subtasks);
  const draftTotal = baseline.reduce((sum, s) => sum + s.costCents, 0);

  const usesPlanFlow = acceptanceStatus !== null;
  const planDraft = usesPlanFlow && acceptanceStatus === 'accepted' && !planSubmittedAt && !planApprovedAt;
  const planPending = usesPlanFlow && !!planSubmittedAt && !planApprovedAt;
  const planLocked = usesPlanFlow && !!planApprovedAt;
  const wasSentBack = planSteps.some((s) => s.decision === 'rejected');

  const canTick = isAssignee && (planLocked || !usesPlanFlow);
  const canHandBack =
    isAssignee && acceptanceStatus === 'accepted' && taskStatus !== 'submitted' && taskStatus !== 'done';

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

  function attachPhoto(subtaskId: string) {
    const pick = async (fromCamera: boolean) => {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable camera / photo access in Settings.');
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, exif: true })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
      const a = res.canceled ? null : res.assets[0];
      if (!a?.base64) return;
      const ext = (a.mimeType?.split('/')[1] || a.uri.split('.').pop() || 'jpg').toLowerCase();
      await run(() =>
        uploadTaskPhoto({
          orgId,
          projectId,
          taskId,
          base64: a.base64!,
          ext,
          mime: a.mimeType ?? 'image/jpeg',
          subtaskId,
          purpose: 'subtask',
          gpsLat: a.exif?.GPSLatitude ?? null,
          gpsLng: a.exif?.GPSLongitude ?? null,
        }),
      );
    };
    Alert.alert('Add step photo', undefined, [
      { text: 'Take photo', onPress: () => void pick(true) },
      { text: 'Choose from library', onPress: () => void pick(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Acceptance decision for the assigned contractor ──
  if (acceptanceStatus === 'pending' && isAssignee) {
    return (
      <Card>
        <Text style={styles.title}>Accept this task?</Text>
        <Text style={styles.hint}>Accept to plan and price your work, or decline to send it back to the PM.</Text>
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
              placeholderTextColor={colors.subtle}
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
        <Text style={styles.title}>{planDraft || planPending ? 'Plan & cost' : 'Task plan'}</Text>
        {(planLocked || !usesPlanFlow) && (
          <Text style={styles.count}>
            {done}/{counted.length} · {pct}%
          </Text>
        )}
      </View>

      {acceptanceStatus === 'pending' && !isAssignee && (
        <Text style={styles.pending}>Waiting for the contractor to accept.</Text>
      )}
      {acceptanceStatus === 'rejected' && !planDraft && (
        <Text style={styles.declined}>This task was declined and returned to the PM.</Text>
      )}

      {/* Awarded value (baseline locked) */}
      {planLocked && (
        <View style={styles.awardBox}>
          <Text style={styles.awardLabel}>Awarded value</Text>
          <Text style={styles.awardValue}>{formatUsd(awardedCostCents ?? 0)}</Text>
        </View>
      )}

      {/* Plan awaiting approval */}
      {planPending && (
        <View style={{ marginTop: 10 }}>
          <View style={styles.pendingBox}>
            <Text style={styles.pendingBoxText}>
              {isAssignee ? 'Your plan is awaiting approval.' : 'Priced plan submitted — awaiting approval.'}
            </Text>
            <Text style={styles.pendingBoxTotal}>{formatUsd(draftTotal)}</Text>
          </View>
          <View style={{ marginTop: 8, gap: 6 }}>
            {baseline.map((s) => (
              <View key={s.id} style={styles.pendRow}>
                <Text style={styles.pendRowTitle}>{s.title}</Text>
                <Text style={styles.pendRowMeta}>
                  {s.estQty ? `${s.estQty} ${s.estUnit} · ` : ''}
                  {formatUsd(s.costCents)}
                </Text>
              </View>
            ))}
          </View>
          <ApprovalChain steps={planSteps} viewerRole={viewerRole} onDecided={onChanged} />
        </View>
      )}

      {/* Plan draft — priced editor (assignee) */}
      {planDraft && isAssignee && (
        <View style={{ marginTop: 10, gap: 10 }}>
          {wasSentBack && (
            <Text style={styles.sentBack}>Your plan was sent back. Revise the steps or costs and resubmit.</Text>
          )}
          <Text style={styles.hint}>
            Break the task into the steps needed to complete it — each with a duration, start date and cost. This is
            your quote; it goes to the PM &amp; admin for approval.
          </Text>

          {baseline.map((s) => (
            <View key={s.id} style={styles.editRow}>
              <View style={styles.editTop}>
                <TextInput
                  defaultValue={s.title}
                  onEndEditing={(e) => run(() => updateSubtask(s.id, { title: e.nativeEvent.text.trim() }))}
                  placeholder="Step"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable disabled={busy} onPress={() => run(() => removeSubtask(s.id))} hitSlop={8}>
                  <Ionicons name="close" size={18} color={colors.subtle} />
                </Pressable>
              </View>
              <View style={styles.editGrid}>
                <TextInput
                  defaultValue={s.estQty != null ? String(s.estQty) : ''}
                  onEndEditing={(e) => run(() => updateSubtask(s.id, { estQty: Number(e.nativeEvent.text) || null }))}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, styles.qty]}
                />
                <View style={styles.unitToggle}>
                  {(['hours', 'days'] as const).map((u) => (
                    <Pressable
                      key={u}
                      style={[styles.unitBtn, s.estUnit === u && styles.unitBtnOn]}
                      disabled={busy}
                      onPress={() => run(() => updateSubtask(s.id, { estUnit: u }))}
                    >
                      <Text style={[styles.unitText, s.estUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  defaultValue={dollars(s.costCents)}
                  onEndEditing={(e) =>
                    run(() => updateSubtask(s.id, { costCents: Math.round((Number(e.nativeEvent.text) || 0) * 100) }))
                  }
                  keyboardType="numeric"
                  placeholder="Cost $"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, styles.cost]}
                />
              </View>
              <DateField
                label="Start"
                value={s.plannedStartDate}
                onChange={(d) => run(() => updateSubtask(s.id, { plannedStartDate: d }))}
                min={taskStart}
                max={taskEnd}
              />
            </View>
          ))}

          {/* Add a step */}
          <View style={styles.addBlock}>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Add a step…"
              placeholderTextColor={colors.subtle}
              style={styles.input}
            />
            <View style={styles.editGrid}>
              <TextInput
                value={newQty}
                onChangeText={setNewQty}
                keyboardType="numeric"
                placeholder="Qty"
                placeholderTextColor={colors.subtle}
                style={[styles.input, styles.qty]}
              />
              <View style={styles.unitToggle}>
                {(['hours', 'days'] as const).map((u) => (
                  <Pressable key={u} style={[styles.unitBtn, newUnit === u && styles.unitBtnOn]} onPress={() => setNewUnit(u)}>
                    <Text style={[styles.unitText, newUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={newCost}
                onChangeText={setNewCost}
                keyboardType="numeric"
                placeholder="Cost $"
                placeholderTextColor={colors.subtle}
                style={[styles.input, styles.cost]}
              />
            </View>
            <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={taskEnd} />
            <Pressable
              style={[styles.addBtn, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
              disabled={!newTitle.trim() || busy}
              onPress={() =>
                run(async () => {
                  await addSubtask({
                    taskId,
                    orgId,
                    title: newTitle.trim(),
                    costCents: Math.round((Number(newCost) || 0) * 100),
                    estQty: Number(newQty) || null,
                    estUnit: newUnit,
                    plannedStartDate: newStart,
                  });
                  setNewTitle('');
                  setNewQty('');
                  setNewCost('');
                  setNewStart(null);
                })
              }
            >
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.addBtnText}>Add step</Text>}
            </Pressable>
          </View>

          {/* Total + submit */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              Total quote: <Text style={styles.totalValue}>{formatUsd(draftTotal)}</Text>
            </Text>
          </View>
          <Pressable
            style={[styles.btn, styles.btnPrimary, (baseline.length === 0 || busy) && { opacity: 0.5 }]}
            disabled={baseline.length === 0 || busy}
            onPress={() => run(() => submitPlan(taskId))}
          >
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Submit plan for approval</Text>}
          </Pressable>
        </View>
      )}
      {planDraft && !isAssignee && <Text style={styles.hint}>The contractor is preparing a priced plan.</Text>}

      {/* Locked plan / legacy — checklist */}
      {(planLocked || !usesPlanFlow) && (
        <>
          <View style={styles.progressRow}>
            <ProgressBar value={pct} color={colors.brand} />
          </View>

          <View style={styles.list}>
            {counted.map((s) => (
              <View key={s.id} style={styles.itemWrap}>
                <View style={styles.item}>
                  <Pressable disabled={!canTick || busy} onPress={() => run(() => toggleSubtask(s.id, !s.isDone))} hitSlop={8}>
                    <Ionicons
                      name={s.isDone ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={s.isDone ? colors.success : colors.subtle}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemText, s.isDone && styles.itemDone]}>
                      {s.title}
                      {s.isVariation ? '  ·  variation' : ''}
                    </Text>
                    {(s.plannedStartDate || s.estQty || s.costCents > 0) && (
                      <Text style={styles.itemDates}>
                        {s.estQty ? `${s.estQty}${s.estUnit === 'hours' ? 'h' : 'd'}` : ''}
                        {s.plannedStartDate ? ` · ${s.plannedStartDate}` : ''}
                        {s.costCents > 0 ? ` · ${formatUsd(s.costCents)}` : ''}
                      </Text>
                    )}
                  </View>
                  {!usesPlanFlow && canTick && (
                    <Pressable disabled={busy} onPress={() => run(() => removeSubtask(s.id))} hitSlop={8}>
                      <Ionicons name="close" size={18} color={colors.subtle} />
                    </Pressable>
                  )}
                </View>

                {(canTick || (mediaBySubtask[s.id]?.length ?? 0) > 0) && (
                  <View style={styles.photoRow}>
                    {(mediaBySubtask[s.id] ?? []).map((p) =>
                      p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} /> : null,
                    )}
                    {canTick && (
                      <Pressable style={styles.addPhoto} disabled={busy} onPress={() => attachPhoto(s.id)}>
                        <Ionicons name="camera-outline" size={16} color={colors.brand} />
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))}
            {counted.length === 0 && (
              <Text style={styles.empty}>{!usesPlanFlow && canTick ? 'Break the task into steps below.' : 'No plan steps.'}</Text>
            )}
          </View>

          {/* Legacy/internal tasks keep a simple (uncosted) add-step form. */}
          {!usesPlanFlow && canTick && (
            <View style={styles.addBlock}>
              <View style={styles.addRow}>
                <TextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Add a step…"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable
                  style={[styles.addBtnInline, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
                  disabled={!newTitle.trim() || busy}
                  onPress={() =>
                    run(async () => {
                      if (newStart && newEnd && newStart > newEnd) throw new Error('The step’s start date is after its end date.');
                      await addSubtask({ taskId, orgId, title: newTitle.trim(), plannedStartDate: newStart, plannedEndDate: newEnd });
                      setNewTitle('');
                      setNewStart(null);
                      setNewEnd(null);
                    })
                  }
                >
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.addBtnText}>Add</Text>}
                </Pressable>
              </View>
              <View style={styles.editGrid}>
                <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={newEnd ?? taskEnd} />
                <DateField label="End" value={newEnd} onChange={setNewEnd} min={newStart ?? taskStart} max={taskEnd} />
              </View>
            </View>
          )}

          {canTick && counted.length > 0 && done < counted.length && (
            <Text style={styles.gateHint}>Tick every step to unlock Submit for sign-off.</Text>
          )}
        </>
      )}

      {canHandBack && (
        <View style={styles.handBack}>
          {!handBackOpen ? (
            <Pressable onPress={() => setHandBackOpen(true)}>
              <Text style={styles.handBackLink}>Can’t complete this? Hand the task back</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why are you handing it back? (shared with the PM)"
                placeholderTextColor={colors.subtle}
                style={styles.input}
                multiline
              />
              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnDanger]}
                  disabled={busy || !reason.trim()}
                  onPress={() =>
                    run(async () => {
                      await returnTask(taskId, reason.trim());
                      setHandBackOpen(false);
                      setReason('');
                    })
                  }
                >
                  <Text style={styles.btnPrimaryText}>Hand back task</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => setHandBackOpen(false)}>
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    title: { fontSize: 15, fontFamily: font.bodyHeavy, color: c.text },
    hint: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 4 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    count: { fontSize: 12, fontFamily: font.bodyBold, color: c.muted },
    pending: { fontSize: 13, fontFamily: font.body, color: c.accent, marginTop: 4 },
    declined: { fontSize: 13, fontFamily: font.body, color: c.danger, marginTop: 4 },
    sentBack: { fontSize: 13, fontFamily: font.bodySemi, color: c.danger },
    awardBox: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.brandSoft,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    awardLabel: { fontSize: 13, fontFamily: font.body, color: c.muted },
    awardValue: { fontSize: 15, fontFamily: font.bodyBold, color: c.brandDeep },
    pendingBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.sunk,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    pendingBoxText: { flex: 1, fontSize: 13, fontFamily: font.bodySemi, color: c.accent },
    pendingBoxTotal: { fontSize: 14, fontFamily: font.bodyBold, color: c.text },
    pendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    pendRowTitle: { flex: 1, fontSize: 14, fontFamily: font.body, color: c.text },
    pendRowMeta: { fontSize: 11, fontFamily: font.body, color: c.subtle },
    progressRow: { marginTop: 10 },
    list: { marginTop: 10, gap: 12 },
    itemWrap: { gap: 6 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 32 },
    thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: c.border },
    addPhoto: {
      width: 44,
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemText: { fontSize: 14, fontFamily: font.body, color: c.text },
    itemDone: { color: c.subtle, textDecorationLine: 'line-through' },
    itemDates: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 1 },
    empty: { fontSize: 13, fontFamily: font.body, color: c.subtle, paddingVertical: 6 },
    row: { flexDirection: 'row', gap: 8, marginTop: 4 },
    btn: { flex: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
    btnPrimary: { backgroundColor: c.brand },
    btnPrimaryText: { color: c.onBrand, fontFamily: font.bodyBold },
    btnDanger: { backgroundColor: c.danger },
    btnOutline: { borderWidth: 1, borderColor: c.border },
    btnOutlineText: { color: c.text, fontFamily: font.bodySemi },
    input: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: font.body,
      color: c.text,
    },
    editRow: { gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10 },
    editTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    editGrid: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    qty: { width: 64, textAlign: 'center' },
    cost: { flex: 1, textAlign: 'right' },
    unitToggle: { flexDirection: 'row', borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden' },
    unitBtn: { paddingHorizontal: 10, paddingVertical: 9 },
    unitBtnOn: { backgroundColor: c.brand },
    unitText: { fontSize: 12, fontFamily: font.bodySemi, color: c.muted },
    unitTextOn: { color: c.onBrand },
    addBlock: { gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    addBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' },
    addBtnInline: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11 },
    addBtnText: { color: c.onBrand, fontFamily: font.bodyBold },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    totalLabel: { fontSize: 13, fontFamily: font.body, color: c.muted },
    totalValue: { fontFamily: font.bodyBold, color: c.text },
    gateHint: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    handBack: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
    handBackLink: { fontSize: 12, fontFamily: font.bodySemi, color: c.subtle },
  });
