import { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Card, ProgressBar } from './ui';
import { theme } from '../lib/theme';
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

export function SubtaskPanel({
  taskId,
  orgId,
  projectId,
  subtasks,
  mediaBySubtask,
  acceptanceStatus,
  isAssignee,
  taskStatus,
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
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [newTitle, setNewTitle] = useState('');
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

            {(canEdit || (mediaBySubtask[s.id]?.length ?? 0) > 0) && (
              <View style={styles.photoRow}>
                {(mediaBySubtask[s.id] ?? []).map((p) =>
                  p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} /> : null,
                )}
                {canEdit && (
                  <Pressable style={styles.addPhoto} disabled={busy} onPress={() => attachPhoto(s.id)}>
                    <Ionicons name="camera-outline" size={16} color={theme.color.accent} />
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
                placeholderTextColor={theme.color.subtle}
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

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '800', color: theme.color.text },
  hint: { fontSize: 13, color: theme.color.muted, marginTop: 4, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 12, fontWeight: '700', color: theme.color.muted },
  pending: { fontSize: 13, color: theme.color.warning, marginTop: 4 },
  progressRow: { marginTop: 10 },
  list: { marginTop: 10, gap: 12 },
  itemWrap: { gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 32 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.color.border },
  addPhoto: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  handBack: { marginTop: 14, borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: 12 },
  handBackLink: { fontSize: 12, fontWeight: '600', color: theme.color.subtle },
});
