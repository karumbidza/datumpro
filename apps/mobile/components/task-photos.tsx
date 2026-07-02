import { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { listTaskPhotos, uploadTaskPhoto, type TaskPhoto } from '../lib/data/media';

interface Props {
  orgId: string;
  projectId: string;
  taskId: string;
}

/** Site-evidence photos for a task: capture with the camera or pick from the
 *  library, upload to project-media, and show what's already attached. */
export function TaskPhotos({ orgId, projectId, taskId }: Props) {
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPhotos(await listTaskPhotos(taskId));
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(fromCamera: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable camera / photo access in Settings to attach photos.');
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset?.base64) return;
      const ext = (asset.mimeType?.split('/')[1] || asset.uri.split('.').pop() || 'jpg').toLowerCase();
      await uploadTaskPhoto({
        orgId,
        projectId,
        taskId,
        base64: asset.base64,
        ext,
        mime: asset.mimeType ?? 'image/jpeg',
      });
      await load();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Site photos</Text>

      {photos.length > 0 && (
        <View style={styles.grid}>
          {photos.map((p) =>
            p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} /> : null,
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={() => add(true)} disabled={busy}>
          <Text style={styles.btnText}>Take photo</Text>
        </Pressable>
        <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={() => add(false)} disabled={busy}>
          <Text style={styles.btnText}>Choose photo</Text>
        </Pressable>
        {busy && <ActivityIndicator style={{ marginLeft: 4 }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8, marginTop: 8 },
  label: { fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#f4f4f5' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: '#eef2ff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#4338ca', fontWeight: '600' },
});
