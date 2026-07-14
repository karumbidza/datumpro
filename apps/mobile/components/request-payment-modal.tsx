import { useState } from 'react';
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
import {
  requestPayment,
  uploadPaymentDoc,
  type RequestProject,
} from '../lib/data/payment-requests';
import { theme } from '../lib/theme';

/** Contractor's "Request payment" modal — pick a project, enter amount + title,
 *  optionally attach an invoice photo, submit. */
export function RequestPaymentModal({
  visible,
  projects,
  onClose,
  onDone,
}: {
  visible: boolean;
  projects: RequestProject[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<{ base64: string; ext: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  async function attach() {
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    if (res.canceled || !res.assets[0]?.base64) return;
    const a = res.assets[0];
    const ext = a.uri.split('.').pop()?.toLowerCase() || 'jpg';
    setDoc({ base64: a.base64!, ext, mime: a.mimeType ?? 'image/jpeg' });
  }

  async function submit() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!project || !title.trim() || !Number.isFinite(cents) || cents <= 0) {
      Alert.alert('Missing details', 'Pick a project, a description, and a valid amount.');
      return;
    }
    setBusy(true);
    try {
      let invoicePath: string | null = null;
      let invoiceName: string | null = null;
      if (doc) {
        const up = await uploadPaymentDoc({ orgId: project.orgId, projectId: project.id, base64: doc.base64, ext: doc.ext, mime: doc.mime });
        invoicePath = up.path;
        invoiceName = up.name;
      }
      await requestPayment({
        projectId: project.id,
        title: title.trim(),
        amountCents: cents,
        note: note.trim() || null,
        invoicePath,
        invoiceName,
      });
      setTitle('');
      setAmount('');
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
          {projects.length > 1 && (
            <>
              <Text style={styles.label}>Project</Text>
              <View style={styles.chips}>
                {projects.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setProjectId(p.id)}
                    style={[styles.chip, p.id === project?.id && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, p.id === project?.id && styles.chipTextOn]}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Description</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Foundations — 40%" placeholderTextColor={theme.color.subtle} style={styles.input} />

          <Text style={styles.label}>Amount (USD)</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.color.subtle} style={styles.input} />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Anything the reviewer should know" placeholderTextColor={theme.color.subtle} style={styles.input} />

          <Pressable onPress={attach} style={styles.attach}>
            <Text style={styles.attachText}>{doc ? '✓ Invoice attached — replace' : 'Attach invoice photo (optional)'}</Text>
          </Pressable>

          <Pressable onPress={submit} disabled={busy} style={[styles.submit, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={theme.color.onDark} /> : <Text style={styles.submitText}>Submit request</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 18, fontWeight: '800', color: theme.color.text },
  cancel: { fontSize: 15, color: theme.color.subtle },
  body: { padding: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: theme.color.subtle, marginTop: 8 },
  input: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.color.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border },
  chipOn: { backgroundColor: theme.color.dark, borderColor: theme.color.dark },
  chipText: { fontSize: 13, color: theme.color.text },
  chipTextOn: { color: theme.color.onDark, fontWeight: '700' },
  attach: { marginTop: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingVertical: 12, alignItems: 'center' },
  attachText: { fontSize: 14, color: theme.color.accent, fontWeight: '600' },
  submit: { marginTop: 16, backgroundColor: theme.color.dark, borderRadius: theme.radius.pill, paddingVertical: 14, alignItems: 'center' },
  busy: { opacity: 0.6 },
  submitText: { color: theme.color.onDark, fontWeight: '800', fontSize: 15 },
});
