import { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { listTaskPhotos, uploadTaskPhoto, type TaskPhoto } from '../lib/data/media';
import { theme } from '../lib/theme';

interface Props {
  orgId: string;
  projectId: string;
  taskId: string;
}

/** Pull a signed decimal lat/lng out of a photo's EXIF. Handles the flattened
 *  keys (Android / Expo) and the nested {GPS:{…}} shape (iOS), applying the N/S
 *  and E/W refs. Returns null when the photo has no usable fix. */
function exifGps(exif: Record<string, unknown> | null | undefined): { lat: number; lng: number } | null {
  if (!exif) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
  const nested = (exif.GPS ?? {}) as Record<string, unknown>;

  let lat = num(exif.GPSLatitude) ?? num(nested.Latitude);
  let lng = num(exif.GPSLongitude) ?? num(nested.Longitude);
  const latRef = (exif.GPSLatitudeRef ?? nested.LatitudeRef) as string | undefined;
  const lngRef = (exif.GPSLongitudeRef ?? nested.LongitudeRef) as string | undefined;
  if (lat == null || lng == null) return null;

  if (latRef === 'S') lat = -Math.abs(lat);
  if (lngRef === 'W') lng = -Math.abs(lng);
  if (lat === 0 && lng === 0) return null; // no fix
  return { lat, lng };
}

function openInMaps(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
}

/** Site-evidence photos for a task: capture with the camera or pick from the
 *  library, geotag from the photo's EXIF, upload, and show what's attached. */
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
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, exif: true })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, exif: true, mediaTypes: ['images'] });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset?.base64) return;
      const ext = (asset.mimeType?.split('/')[1] || asset.uri.split('.').pop() || 'jpg').toLowerCase();
      const gps = exifGps(asset.exif as Record<string, unknown> | null | undefined);
      await uploadTaskPhoto({
        orgId,
        projectId,
        taskId,
        base64: asset.base64,
        ext,
        mime: asset.mimeType ?? 'image/jpeg',
        gpsLat: gps?.lat ?? null,
        gpsLng: gps?.lng ?? null,
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
          {photos.map((p) => {
            if (!p.url) return null;
            const located = p.gpsLat != null && p.gpsLng != null;
            return (
              <Pressable
                key={p.id}
                onPress={() => located && openInMaps(p.gpsLat as number, p.gpsLng as number)}
                disabled={!located}
              >
                <Image source={{ uri: p.url }} style={styles.thumb} />
                {located && (
                  <View style={styles.geoBadge}>
                    <Ionicons name="location" size={11} color="#fff" />
                    <Text style={styles.geoText}>Located</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
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
  geoBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  geoText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: theme.color.accentSoft, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: theme.color.accent, fontWeight: '600' },
});
