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
import { DocAttach } from './doc-attach';
import type { TaskDoc } from '../lib/data/tenders';
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
  variationSteps,
  viewerRole,
  planDocs,
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
  /** task_variation approval chains, keyed by the variation subtask's id. */
  variationSteps: Record<string, ApprovalStep[]>;
  viewerRole: string;
  planDocs: TaskDoc[];
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
  const [addOpen, setAddOpen] = useState(false);
  // Editing an existing plan step — one local buffer, saved on Done (no
  // save-on-every-keystroke churn).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eQty, setEQty] = useState('');
  const [eUnit, setEUnit] = useState<'hours' | 'days'>('days');
  const [eStart, setEStart] = useState<string | null>(null);
  const [eCost, setECost] = useState('');

  function openEdit(s: Subtask) {
    setEditingId(s.id);
    setETitle(s.title);
    setEQty(s.estQty != null ? String(s.estQty) : '');
    setEUnit(s.estUnit ?? 'days');
    setEStart(s.plannedStartDate);
    setECost(s.costCents ? dollars(s.costCents) : '');
  }
  const stepIncomplete = (s: Subtask) => !s.estQty || !s.estUnit || !s.plannedStartDate || s.costCents <= 0;

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

  const openVariations = subtasks.filter((s) => s.isVariation && s.variationStatus !== 'approved');
  const canAddVariation = isAssignee && planLocked && taskStatus !== 'submitted' && taskStatus !== 'done';
  const [variationOpen, setVariationOpen] = useState(false);

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

          {baseline.map((s) =>
            editingId === s.id ? (
              <View key={s.id} style={styles.editRow}>
                <TextInput
                  value={eTitle}
                  onChangeText={setETitle}
                  placeholder="What's the step?"
                  placeholderTextColor={colors.subtle}
                  style={styles.input}
                />
                <View style={styles.editGrid}>
                  <TextInput value={eQty} onChangeText={setEQty} keyboardType="numeric" placeholder="Duration" placeholderTextColor={colors.subtle} style={[styles.input, styles.qty]} />
                  <View style={styles.unitToggle}>
                    {(['hours', 'days'] as const).map((u) => (
                      <Pressable key={u} style={[styles.unitBtn, eUnit === u && styles.unitBtnOn]} onPress={() => setEUnit(u)}>
                        <Text style={[styles.unitText, eUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput value={eCost} onChangeText={setECost} keyboardType="numeric" placeholder="Cost $" placeholderTextColor={colors.subtle} style={[styles.input, styles.cost]} />
                </View>
                <DateField label="Start" value={eStart} onChange={setEStart} min={taskStart} max={taskEnd} />
                <View style={styles.row}>
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, (!eTitle.trim() || busy) && { opacity: 0.5 }]}
                    disabled={!eTitle.trim() || busy}
                    onPress={() =>
                      run(async () => {
                        await updateSubtask(s.id, {
                          title: eTitle.trim(),
                          estQty: Number(eQty) || null,
                          estUnit: eUnit,
                          plannedStartDate: eStart,
                          costCents: Math.round((Number(eCost) || 0) * 100),
                        });
                        setEditingId(null);
                      })
                    }
                  >
                    {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Done</Text>}
                  </Pressable>
                  <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => setEditingId(null)}>
                    <Text style={styles.btnOutlineText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View key={s.id} style={styles.stepCard}>
                <Pressable style={{ flex: 1 }} onPress={() => openEdit(s)}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  <Text style={[styles.stepMeta, stepIncomplete(s) && styles.stepWarn]}>
                    {stepIncomplete(s)
                      ? '⚠ Tap to add duration, start date & cost'
                      : `${s.estQty} ${s.estUnit} · ${s.plannedStartDate} · ${formatUsd(s.costCents)}`}
                  </Text>
                </Pressable>
                <Pressable onPress={() => openEdit(s)} hitSlop={8}>
                  <Ionicons name="create-outline" size={18} color={colors.subtle} />
                </Pressable>
                <Pressable disabled={busy} onPress={() => run(() => removeSubtask(s.id))} hitSlop={8}>
                  <Ionicons name="close" size={18} color={colors.subtle} />
                </Pressable>
              </View>
            ),
          )}

          {/* Add a step */}
          {!addOpen ? (
            <Pressable style={styles.addStepBtn} onPress={() => setAddOpen(true)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
              <Text style={styles.addStepText}>Add a step</Text>
            </Pressable>
          ) : (
            <View style={styles.addBlock}>
              <TextInput
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="What's the step?"
                placeholderTextColor={colors.subtle}
                style={styles.input}
              />
              <View style={styles.editGrid}>
                <TextInput value={newQty} onChangeText={setNewQty} keyboardType="numeric" placeholder="Duration" placeholderTextColor={colors.subtle} style={[styles.input, styles.qty]} />
                <View style={styles.unitToggle}>
                  {(['hours', 'days'] as const).map((u) => (
                    <Pressable key={u} style={[styles.unitBtn, newUnit === u && styles.unitBtnOn]} onPress={() => setNewUnit(u)}>
                      <Text style={[styles.unitText, newUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput value={newCost} onChangeText={setNewCost} keyboardType="numeric" placeholder="Cost $" placeholderTextColor={colors.subtle} style={[styles.input, styles.cost]} />
              </View>
              <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={taskEnd} />
              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
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
                      setAddOpen(false);
                    })
                  }
                >
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Add step</Text>}
                </Pressable>
                <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => setAddOpen(false)}>
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Total + submit */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              Total quote: <Text style={styles.totalValue}>{formatUsd(draftTotal)}</Text>
            </Text>
          </View>
          {(() => {
            const need = baseline.filter(stepIncomplete).length;
            if (baseline.length === 0) return <Text style={styles.gateHint}>Add at least one step to build your plan.</Text>;
            if (need > 0)
              return (
                <Text style={styles.gateHint}>
                  {need} step{need === 1 ? '' : 's'} still need a duration, start date &amp; cost.
                </Text>
              );
            return null;
          })()}
          <Pressable
            style={[styles.btn, styles.btnPrimary, (baseline.length === 0 || baseline.some(stepIncomplete) || busy) && { opacity: 0.5 }]}
            disabled={baseline.length === 0 || baseline.some(stepIncomplete) || busy}
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

          {/* Variations — extra scope raised after the baseline was locked */}
          {planLocked && (openVariations.length > 0 || canAddVariation) && (
            <View style={styles.variations}>
              <Text style={styles.varHeader}>Variations</Text>
              {openVariations.map((v) => (
                <View key={v.id} style={styles.varCard}>
                  <View style={styles.varTop}>
                    <Text style={styles.varTitle}>{v.title}</Text>
                    <View style={styles.varRight}>
                      <Text style={styles.varCost}>{formatUsd(v.costCents)}</Text>
                      <View style={[styles.varBadge, v.variationStatus === 'rejected' ? styles.varBadgeRej : styles.varBadgePend]}>
                        <Text style={[styles.varBadgeText, v.variationStatus === 'rejected' ? styles.varBadgeTextRej : styles.varBadgeTextPend]}>
                          {v.variationStatus === 'rejected' ? 'Declined' : 'Pending'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {v.variationStatus === 'pending' && (
                    <ApprovalChain steps={variationSteps[v.id] ?? []} viewerRole={viewerRole} onDecided={onChanged} />
                  )}
                </View>
              ))}

              {canAddVariation &&
                (!variationOpen ? (
                  <Pressable onPress={() => setVariationOpen(true)}>
                    <Text style={styles.varAddLink}>+ Add a variation (needs approval)</Text>
                  </Pressable>
                ) : (
                  <View style={styles.varForm}>
                    <TextInput
                      value={newTitle}
                      onChangeText={setNewTitle}
                      placeholder="Extra step…"
                      placeholderTextColor={colors.subtle}
                      style={styles.input}
                    />
                    <View style={styles.editGrid}>
                      <TextInput value={newQty} onChangeText={setNewQty} keyboardType="numeric" placeholder="Duration" placeholderTextColor={colors.subtle} style={[styles.input, styles.qty]} />
                      <View style={styles.unitToggle}>
                        {(['hours', 'days'] as const).map((u) => (
                          <Pressable key={u} style={[styles.unitBtn, newUnit === u && styles.unitBtnOn]} onPress={() => setNewUnit(u)}>
                            <Text style={[styles.unitText, newUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput value={newCost} onChangeText={setNewCost} keyboardType="numeric" placeholder="Cost $" placeholderTextColor={colors.subtle} style={[styles.input, styles.cost]} />
                    </View>
                    <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={taskEnd} />
                    <View style={styles.row}>
                      <Pressable
                        style={[styles.btn, styles.btnPrimary, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
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
                            setVariationOpen(false);
                          })
                        }
                      >
                        {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Submit variation</Text>}
                      </Pressable>
                      <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => setVariationOpen(false)}>
                        <Text style={styles.btnOutlineText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </>
      )}

      {usesPlanFlow && (planDraft || planPending || planLocked) && (
        <DocAttach taskId={taskId} orgId={orgId} projectId={projectId} docs={planDocs} canEdit={isAssignee} onChanged={onChanged} />
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
    editRow: { gap: 8, borderWidth: 1, borderColor: c.brand, borderRadius: radius.md, padding: 10 },
    stepCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    stepTitle: { fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    stepMeta: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 2 },
    stepWarn: { color: c.accent, fontFamily: font.bodySemi },
    editGrid: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    qty: { width: 64, textAlign: 'center' },
    cost: { flex: 1, textAlign: 'right' },
    unitToggle: { flexDirection: 'row', borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden' },
    unitBtn: { paddingHorizontal: 10, paddingVertical: 9 },
    unitBtnOn: { backgroundColor: c.brand },
    unitText: { fontSize: 12, fontFamily: font.bodySemi, color: c.muted },
    unitTextOn: { color: c.onBrand },
    addBlock: { gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10 },
    addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    addBtnInline: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11 },
    addBtnText: { color: c.onBrand, fontFamily: font.bodyBold },
    addStepBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: c.brand,
      borderStyle: 'dashed',
      borderRadius: radius.md,
      paddingVertical: 12,
    },
    addStepText: { color: c.brand, fontFamily: font.bodyBold, fontSize: 14 },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    totalLabel: { fontSize: 13, fontFamily: font.body, color: c.muted },
    totalValue: { fontFamily: font.bodyBold, color: c.text },
    gateHint: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    variations: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 8 },
    varHeader: { fontSize: 11, fontFamily: font.bodyBold, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    varCard: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10, gap: 4 },
    varTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    varTitle: { flex: 1, fontSize: 14, fontFamily: font.body, color: c.text },
    varRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    varCost: { fontSize: 11, fontFamily: font.body, color: c.subtle },
    varBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    varBadgePend: { backgroundColor: c.sunk },
    varBadgeRej: { backgroundColor: c.danger },
    varBadgeText: { fontSize: 10, fontFamily: font.bodyBold },
    varBadgeTextPend: { color: c.accent },
    varBadgeTextRej: { color: c.onBrand },
    varAddLink: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    varForm: { gap: 8 },
    handBack: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
    handBackLink: { fontSize: 12, fontFamily: font.bodySemi, color: c.subtle },
  });
