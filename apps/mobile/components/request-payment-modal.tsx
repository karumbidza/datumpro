import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { formatUsd } from '@datumpro/shared/domain';
import { requestPayment, uploadPaymentDoc } from '../lib/data/payment-requests';
import type { OwedTask } from '../lib/data/owed';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

/** "Request payment" modal — invoice against an approved task. Amount is capped
 *  at what's still claimable; an invoice is mandatory. */
export function RequestPaymentModal({
  visible,
  tasks,
  onClose,
  onDone,
}: {
  visible: boolean;
  tasks: OwedTask[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const claimable = useMemo(() => tasks.filter((t) => t.requestableCents > 0), [tasks]);
  const [taskId, setTaskId] = useState(claimable[0]?.taskId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<{ base64: string; ext: string; mime: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const task = claimable.find((t) => t.taskId === taskId) ?? claimable[0];

  // Default the amount to the picked task's full outstanding.
  useEffect(() => {
    if (task) setAmount((task.requestableCents / 100).toFixed(2));
  }, [task?.taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fromImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Enable camera / photo access in Settings.');
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    const a = res.canceled ? null : res.assets[0];
    if (!a?.base64) return;
    const ext = (a.mimeType?.split('/')[1] || a.uri.split('.').pop() || 'jpg').toLowerCase();
    setDoc({ base64: a.base64, ext, mime: a.mimeType ?? 'image/jpeg', name: a.fileName ?? `invoice.${ext}` });
  }

  async function fromDocument() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
      copyToCacheDirectory: true,
    });
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    try {
      const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const ext = (a.name.split('.').pop() || a.mimeType?.split('/')[1] || 'pdf').toLowerCase();
      setDoc({ base64, ext, mime: a.mimeType ?? 'application/octet-stream', name: a.name });
    } catch (e) {
      Alert.alert('Could not read file', e instanceof Error ? e.message : 'Please try another file.');
    }
  }

  function attach() {
    Alert.alert('Attach invoice', undefined, [
      { text: 'Take photo', onPress: () => void fromImage(true) },
      { text: 'Photo library', onPress: () => void fromImage(false) },
      { text: 'Document (PDF / Excel)', onPress: () => void fromDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function submit() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!task) return Alert.alert('Pick a task', 'Choose an approved task to invoice.');
    if (!Number.isFinite(cents) || cents <= 0) return Alert.alert('Amount', 'Enter a valid amount.');
    if (cents > task.requestableCents)
      return Alert.alert('Too much', `You can request up to ${formatUsd(task.requestableCents)}.`);
    if (!doc) return Alert.alert('Invoice required', 'Attach your invoice to proceed.');

    setBusy(true);
    try {
      const up = await uploadPaymentDoc({ orgId: task.orgId, projectId: task.projectId, base64: doc.base64, ext: doc.ext, mime: doc.mime });
      await requestPayment({
        taskId: task.taskId,
        orgId: task.orgId,
        projectId: task.projectId,
        title: task.title,
        amountCents: cents,
        note: note.trim() || null,
        invoicePath: up.path,
        invoiceName: doc.name,
      });
      setNote('');
      setDoc(null);
      onDone();
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Request payment</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {claimable.length === 0 ? (
            <Text style={styles.hint}>
              Nothing to invoice yet. When a plan you priced is approved, its amount shows here to claim against.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Task (approved plan)</Text>
              <View style={styles.chips}>
                {claimable.map((t) => (
                  <Pressable
                    key={t.taskId}
                    onPress={() => setTaskId(t.taskId)}
                    style={[styles.chip, t.taskId === task?.taskId && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, t.taskId === task?.taskId && styles.chipTextOn]} numberOfLines={1}>
                      {t.title} · {formatUsd(t.requestableCents)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Amount (USD) · up to {formatUsd(task?.requestableCents ?? 0)}</Text>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.subtle} style={styles.input} />

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Anything the reviewer should know" placeholderTextColor={colors.subtle} style={styles.input} />

              <Pressable onPress={attach} style={({ pressed }) => [styles.attach, doc && styles.attachOn, pressed && styles.pressed]}>
                <Text style={[styles.attachText, doc && styles.attachTextOn]} numberOfLines={1}>
                  {doc ? `✓ ${doc.name} — replace` : 'Attach invoice — photo, PDF or Excel (required)'}
                </Text>
              </Pressable>

              <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.submit, busy && styles.busy, pressed && styles.pressed]}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>Submit request</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    title: { fontSize: 20, fontFamily: font.displayBold, color: c.text, letterSpacing: -0.3 },
    cancel: { fontSize: 15, fontFamily: font.body, color: c.muted },
    body: { padding: 16, gap: 8 },
    pressed: { opacity: 0.85 },
    hint: { fontSize: 14, fontFamily: font.body, color: c.subtle, paddingVertical: 24, textAlign: 'center' },
    label: { fontSize: 12, fontFamily: font.bodyBold, color: c.subtle, marginTop: 8 },
    input: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: font.body,
      color: c.text,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
    chipOn: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.body, color: c.text },
    chipTextOn: { color: c.bg, fontFamily: font.bodyBold },
    attach: { marginTop: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingVertical: 12, alignItems: 'center' },
    attachOn: { borderColor: c.brand, backgroundColor: c.brandSoft },
    attachText: { fontSize: 14, fontFamily: font.bodySemi, color: c.brand },
    attachTextOn: { color: c.brandDeep },
    submit: { marginTop: 16, backgroundColor: c.brand, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
    busy: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
  });
