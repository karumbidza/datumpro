import { useCallback, useState } from 'react';
import { BrandLoader } from '../../components/brand-loader';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CONTRACTOR_DOC_TYPES,
  CONTRACTOR_DOC_TYPE_LABEL,
  CONTRACTOR_DOC_STATUS_LABEL,
  type ContractorDocType,
  type ContractorDocStatus,
} from '@datumpro/shared/domain';
import {
  listMyDocuments,
  listMyOrgs,
  uploadDocument,
  type MyDocument,
} from '../../lib/data/contractor-documents';
import { Card, Pill } from '../../components/ui';
import { theme, contentWidth, type Tone } from '../../lib/theme';
import { useResponsive } from '../../lib/responsive';

const TONE: Record<ContractorDocStatus, Tone> = {
  submitted: { bg: theme.color.accentSoft, fg: theme.color.accent, bar: theme.color.accent },
  verified: { bg: theme.color.successSoft, fg: theme.color.success, bar: theme.color.success },
  rejected: { bg: '#e5e7eb', fg: '#374151', bar: '#6b7280' },
};

export default function Documents() {
  const { columns, contentMaxWidth } = useResponsive();
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([listMyDocuments(), listMyOrgs()]);
    setDocs(d);
    setOrgs(o);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Documents' }} />
      <View style={styles.head}>
        <Text style={styles.title}>Compliance documents</Text>
        {orgs.length > 0 && (
          <Pressable onPress={() => setOpen(true)} style={styles.addBtn}>
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.sub}>Visible only to you and the admins.</Text>

      {loading ? (
        <View style={{ marginTop: 24, alignSelf: 'center' }}><BrandLoader /></View>
      ) : (
        <FlatList
          data={docs}
          key={`cols-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          keyExtractor={(d) => d.id}
          contentContainerStyle={[styles.list, { maxWidth: contentMaxWidth }]}
          ListEmptyComponent={<Text style={styles.empty}>No documents on file yet.</Text>}
          renderItem={({ item }) => (
            <Card style={[styles.doc, columns > 1 ? styles.col : null]}>
              <View style={styles.docTop}>
                <Text style={styles.docTitle}>{item.title || CONTRACTOR_DOC_TYPE_LABEL[item.docType]}</Text>
                <Pill label={CONTRACTOR_DOC_STATUS_LABEL[item.status]} tone={TONE[item.status]} />
              </View>
              <Text style={styles.docMeta}>
                {CONTRACTOR_DOC_TYPE_LABEL[item.docType]}
                {item.expiryDate ? ` · expires ${item.expiryDate}` : ''}
              </Text>
              {item.status === 'rejected' && item.reviewNote ? (
                <Text style={styles.reject}>“{item.reviewNote}”</Text>
              ) : null}
              {item.fileUrl ? (
                <Pressable onPress={() => Linking.openURL(item.fileUrl!)}>
                  <Text style={styles.link}>View document</Text>
                </Pressable>
              ) : null}
            </Card>
          )}
        />
      )}

      <AddDocumentModal visible={open} orgs={orgs} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void load(); }} />
    </SafeAreaView>
  );
}

function AddDocumentModal({
  visible,
  orgs,
  onClose,
  onDone,
}: {
  visible: boolean;
  orgs: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '');
  const [docType, setDocType] = useState<ContractorDocType>('tax_clearance');
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState('');
  const [doc, setDoc] = useState<{ base64: string; ext: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];

  async function attach() {
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    if (res.canceled || !res.assets[0]?.base64) return;
    const a = res.assets[0];
    setDoc({ base64: a.base64!, ext: a.uri.split('.').pop()?.toLowerCase() || 'jpg', mime: a.mimeType ?? 'image/jpeg' });
  }

  async function submit() {
    if (!org || !doc) {
      Alert.alert('Attach a document', 'Choose an organization and attach a photo of the document.');
      return;
    }
    setBusy(true);
    try {
      await uploadDocument({
        orgId: org.id,
        docType,
        title: title.trim() || null,
        expiryDate: expiry.trim() || null,
        base64: doc.base64,
        ext: doc.ext,
        mime: doc.mime,
      });
      setTitle('');
      setExpiry('');
      setDoc(null);
      onDone();
    } catch (e) {
      Alert.alert('Could not upload', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.title}>Add document</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {orgs.length > 1 && (
            <>
              <Text style={styles.label}>Organization</Text>
              <View style={styles.chips}>
                {orgs.map((o) => (
                  <Pressable key={o.id} onPress={() => setOrgId(o.id)} style={[styles.chip, o.id === org?.id && styles.chipOn]}>
                    <Text style={[styles.chipText, o.id === org?.id && styles.chipTextOn]}>{o.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Type</Text>
          <View style={styles.chips}>
            {CONTRACTOR_DOC_TYPES.map((t) => (
              <Pressable key={t} onPress={() => setDocType(t)} style={[styles.chip, t === docType && styles.chipOn]}>
                <Text style={[styles.chipText, t === docType && styles.chipTextOn]}>{CONTRACTOR_DOC_TYPE_LABEL[t]}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Label (optional)</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Tax Clearance 2026" placeholderTextColor={theme.color.subtle} style={styles.input} />

          <Text style={styles.label}>Expiry date (optional, YYYY-MM-DD)</Text>
          <TextInput value={expiry} onChangeText={setExpiry} placeholder="2027-01-01" placeholderTextColor={theme.color.subtle} style={styles.input} autoCapitalize="none" />

          <Pressable onPress={attach} style={styles.attach}>
            <Text style={styles.attachText}>{doc ? '✓ Document attached — replace' : 'Attach a photo of the document'}</Text>
          </Pressable>

          <Pressable onPress={submit} disabled={busy} style={[styles.submit, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={theme.color.onDark} /> : <Text style={styles.submitText}>Submit</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 22, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: 13, color: theme.color.subtle, paddingHorizontal: 20, marginTop: 2 },
  addBtn: { backgroundColor: theme.color.dark, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  addText: { color: theme.color.onDark, fontWeight: '700', fontSize: 13 },
  list: { padding: 16, gap: 10, ...contentWidth },
  row: { gap: 10 },
  col: { flex: 1 },
  empty: { color: theme.color.subtle, fontSize: 14, textAlign: 'center', marginTop: 32 },
  doc: { gap: 4 },
  docTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  docTitle: { fontSize: 15, fontWeight: '700', color: theme.color.text, flex: 1 },
  docMeta: { fontSize: 12, color: theme.color.muted },
  reject: { fontSize: 12, color: '#dc2626', fontStyle: 'italic' },
  link: { fontSize: 13, fontWeight: '600', color: theme.color.accent, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: theme.color.bg },
  cancel: { fontSize: 15, color: theme.color.subtle },
  form: { padding: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: theme.color.subtle, marginTop: 8 },
  input: { backgroundColor: theme.color.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: theme.color.text },
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
