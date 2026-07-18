import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Card, ProgressBar } from './ui';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import {
  acceptTask,
  declineTask,
  returnTask,
  addSubtask,
  toggleSubtask,
  removeSubtask,
  subtaskPct,
  type Subtask,
} from '../lib/data/subtasks';
import { uploadTaskPhoto, type TaskPhoto } from '../lib/data/media';
import { DateField } from './date-field';

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
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newStart, setNewStart] = useState<string | null>(null);
  const [newEnd, setNewEnd] = useState<string | null>(null);
  // Only the assigned contractor builds and ticks the plan; managers view it.
  const canEdit = isAssignee;
  const canHandBack =
    isAssignee && acceptanceStatus === 'accepted' && taskStatus !== 'submitted' && taskStatus !== 'done';
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
        <Text style={styles.title}>Task plan</Text>
        <Text style={styles.count}>
          {done}/{subtasks.length} · {pct}%
        </Text>
      </View>

      {acceptanceStatus === 'pending' && !isAssignee && (
        <Text style={styles.pending}>Waiting for the contractor to accept.</Text>
      )}

      <View style={styles.progressRow}>
        <ProgressBar value={pct} color={colors.brand} />
      </View>

      <View style={styles.list}>
        {subtasks.map((s) => (
          <View key={s.id} style={styles.itemWrap}>
            <View style={styles.item}>
              <Pressable
                disabled={!canEdit || busy}
                onPress={() => run(() => toggleSubtask(s.id, !s.isDone))}
                hitSlop={8}
              >
                <Ionicons
                  name={s.isDone ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={s.isDone ? colors.success : colors.subtle}
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
                  <Ionicons name="close" size={18} color={colors.subtle} />
                </Pressable>
              )}
            </View>

            {(canEdit || (mediaBySubtask[s.id]?.length ?? 0) > 0) && (
              <View style={styles.photoRow}>
                {(mediaBySubtask[s.id] ?? []).map((p) =>
                  p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} /> : null,
                )}
                {canEdit && (
                  <Pressable style={styles.addPhoto} disabled={busy} onPress={() => attachPhoto(s.id)}>
                    <Ionicons name="camera-outline" size={16} color={colors.brand} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        ))}
        {subtasks.length === 0 && (
          <Text style={styles.empty}>{canEdit ? 'Break the task into steps below.' : 'No plan yet.'}</Text>
        )}
      </View>

      {canEdit && acceptanceStatus !== 'pending' && (
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
              style={[styles.addBtn, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
              disabled={!newTitle.trim() || busy}
              onPress={() =>
                run(async () => {
                  if (newStart && newEnd && newStart > newEnd) {
                    throw new Error('The step’s start date is after its end date.');
                  }
                  await addSubtask({
                    taskId,
                    orgId,
                    title: newTitle.trim(),
                    plannedStartDate: newStart,
                    plannedEndDate: newEnd,
                  });
                  setNewTitle('');
                  setNewStart(null);
                  setNewEnd(null);
                })
              }
            >
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.addBtnText}>Add</Text>}
            </Pressable>
          </View>
          <View style={styles.dateRow}>
            <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={newEnd ?? taskEnd} />
            <DateField label="End" value={newEnd} onChange={setNewEnd} min={newStart ?? taskStart} max={taskEnd} />
          </View>
        </View>
      )}

      {canEdit && subtasks.length > 0 && done < subtasks.length && (
        <Text style={styles.gateHint}>Tick every step to unlock Submit for sign-off.</Text>
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
    hint: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 4, marginBottom: 10 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    count: { fontSize: 12, fontFamily: font.bodyBold, color: c.muted },
    pending: { fontSize: 13, fontFamily: font.body, color: c.accent, marginTop: 4 },
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
    addBlock: { marginTop: 12, gap: 8 },
    addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    dateRow: { flexDirection: 'row', gap: 8 },
    addBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11 },
    addBtnText: { color: c.onBrand, fontFamily: font.bodyBold },
    gateHint: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    handBack: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
    handBackLink: { fontSize: 12, fontFamily: font.bodySemi, color: c.subtle },
  });
