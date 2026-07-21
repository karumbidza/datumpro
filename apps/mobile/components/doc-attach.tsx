import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { uploadTaskDocument, removeTaskDocument, type TaskDoc } from '../lib/data/tenders';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

/** BoQ / invoice PDF attachments for a plan (bid=false) or a sealed bid (bid=true). */
export function DocAttach({
  taskId,
  orgId,
  projectId,
  docs,
  bid = false,
  canEdit,
  onChanged,
}: {
  taskId: string;
  orgId: string;
  projectId: string;
  docs: TaskDoc[];
  bid?: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    setBusy(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      await uploadTaskDocument({
        taskId,
        orgId,
        projectId,
        base64,
        filename: a.name,
        mime: a.mimeType ?? 'application/pdf',
        bid,
      });
      onChanged();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeTaskDocument(id);
      onChanged();
    } catch (e) {
      Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>BoQ / invoice (PDF)</Text>
      {docs.map((d) => (
        <View key={d.id} style={styles.row}>
          <Pressable style={styles.docLink} onPress={() => d.url && Linking.openURL(d.url)}>
            <Ionicons name="document-text-outline" size={16} color={colors.brand} />
            <Text style={styles.docName} numberOfLines={1}>{d.filename}</Text>
          </Pressable>
          {canEdit && (
            <Pressable disabled={busy} onPress={() => remove(d.id)} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.subtle} />
            </Pressable>
          )}
        </View>
      ))}
      {canEdit && (
        <Pressable style={styles.attachBtn} disabled={busy} onPress={pick}>
          {busy ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Ionicons name="attach-outline" size={16} color={colors.brand} />
              <Text style={styles.attachText}>{docs.length > 0 ? 'Attach another PDF' : 'Attach BoQ / invoice PDF'}</Text>
            </>
          )}
        </Pressable>
      )}
      {!canEdit && docs.length === 0 && <Text style={styles.empty}>No documents attached.</Text>}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, marginTop: 10 },
    label: { fontSize: 11, fontFamily: font.bodyBold, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    docLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    docName: { flex: 1, fontSize: 14, fontFamily: font.bodySemi, color: c.brand },
    attachBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: c.brand,
      borderStyle: 'dashed',
      borderRadius: radius.md,
      paddingVertical: 11,
    },
    attachText: { color: c.brand, fontFamily: font.bodyBold, fontSize: 13 },
    empty: { fontSize: 13, fontFamily: font.body, color: c.subtle },
  });
