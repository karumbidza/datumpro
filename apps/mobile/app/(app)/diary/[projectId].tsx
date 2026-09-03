import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  listSiteDiaryEntries,
  saveSiteDiaryEntry,
  deleteSiteDiaryEntry,
  addDiaryPhoto,
  canManageProject,
  type SiteDiaryEntry,
} from '../../../lib/data/site-diary';
import { DateField } from '../../../components/date-field';
import { useSession } from '../../../lib/auth';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${mon} ${d.getDate()}`;
}
/** One-line preview of an entry's filled fields. */
function summary(e: SiteDiaryEntry): string {
  const bits: string[] = [];
  if (e.weather) bits.push(e.weather);
  if (e.temperature != null) bits.push(`${e.temperature}°`);
  if (e.labourCount != null) bits.push(`${e.labourCount} on site`);
  if (e.plant) bits.push(e.plant);
  return bits.join(' · ') || e.notes || 'Logged';
}

export default function ProjectDiary() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { session } = useSession();
  const meId = session?.user.id ?? null;

  const [entries, setEntries] = useState<SiteDiaryEntry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'new' | SiteDiaryEntry | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, manage] = await Promise.all([
      listSiteDiaryEntries(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setEntries(list);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const detail = detailId ? entries.find((e) => e.id === detailId) ?? null : null;

  async function runAction(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function capturePhoto(entry: SiteDiaryEntry, fromCamera: boolean) {
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
    const asset = res.canceled ? null : res.assets[0];
    if (!asset?.base64) return;
    const ext = (asset.mimeType?.split('/')[1] || asset.uri.split('.').pop() || 'jpg').toLowerCase();
    await runAction(() =>
      addDiaryPhoto({ entryId: entry.id, projectId: String(projectId), base64: asset.base64!, ext, mime: asset.mimeType ?? 'image/jpeg' }),
    );
  }
  function addPhoto(entry: SiteDiaryEntry) {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => void capturePhoto(entry, true) },
      { text: 'Choose from library', onPress: () => void capturePhoto(entry, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(entry: SiteDiaryEntry) {
    Alert.alert('Remove entry', `Remove the ${fmtDate(entry.entryDate)} diary entry?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDetailId(null);
          void runAction(() => deleteSiteDiaryEntry(entry.id));
        },
      },
    ]);
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (detail) {
    const canEdit = canManage || detail.createdById === meId;
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, fmtDate(detail.entryDate))} />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Diary</Text>
          </Pressable>

          <Text style={styles.detailTitle}>{fmtDate(detail.entryDate)}</Text>
          {detail.weather ? <DetailRow label="Weather" value={detail.weather} styles={styles} /> : null}
          {detail.temperature != null ? <DetailRow label="Temperature" value={`${detail.temperature}°C`} styles={styles} /> : null}
          {detail.labourCount != null ? <DetailRow label="Labour on site" value={String(detail.labourCount)} styles={styles} /> : null}
          {detail.plant ? <DetailRow label="Plant / equipment" value={detail.plant} styles={styles} /> : null}
          {detail.deliveries ? <DetailRow label="Deliveries" value={detail.deliveries} styles={styles} /> : null}
          {detail.notes ? <DetailRow label="Notes" value={detail.notes} styles={styles} /> : null}
          {detail.createdByName ? <DetailRow label="Logged by" value={detail.createdByName} styles={styles} /> : null}

          <Text style={styles.sectionLabel}>Photos</Text>
          <View style={styles.photoGrid}>
            {detail.photos.map((p) => (p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.photo} /> : null))}
            <Pressable style={styles.addPhoto} onPress={() => addPhoto(detail)} disabled={busy}>
              <Ionicons name="camera-outline" size={22} color={colors.brand} />
              <Text style={styles.addPhotoText}>Add</Text>
            </Pressable>
          </View>

          {canEdit ? (
            <View style={styles.actionsCol}>
              <ActionButton label="Edit" icon="pencil-outline" tone="plain" onPress={() => { setDetailId(null); setComposer(detail); }} styles={styles} colors={colors} disabled={busy} />
              <ActionButton label="Remove" icon="trash-outline" tone="danger" onPress={() => confirmDelete(detail)} styles={styles} colors={colors} disabled={busy} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  if (composer) {
    return (
      <DiaryComposer
        key={composer === 'new' ? 'new' : composer.id}
        projectId={String(projectId)}
        entry={composer === 'new' ? undefined : composer}
        styles={styles}
        colors={colors}
        onCancel={() => setComposer(null)}
        onDone={() => {
          setComposer(null);
          void load();
        }}
      />
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOpts(colors, 'Site diary')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
          <Ionicons name="add" size={18} color={colors.onBrand} />
          <Text style={styles.addBtnText}>Log an entry</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : entries.length === 0 ? (
          <Text style={styles.empty}>No diary entries yet. Log the day’s weather, labour, plant and deliveries.</Text>
        ) : (
          <View style={styles.list}>
            {entries.map((e) => (
              <Pressable key={e.id} style={styles.rowItem} onPress={() => setDetailId(e.id)}>
                <View style={styles.rowBody}>
                  <Text style={styles.itemTitle}>{fmtDate(e.entryDate)}</Text>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {summary(e)}
                    {e.photos.length ? `  ·  ${e.photos.length} photo${e.photos.length === 1 ? '' : 's'}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function headerOpts(colors: Colors, title: string) {
  return {
    title,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: font.displayBold },
  };
}

function DetailRow({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  styles,
  colors,
  disabled,
  tone = 'brand',
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  disabled?: boolean;
  tone?: 'brand' | 'danger' | 'plain';
}) {
  const color = tone === 'danger' ? colors.danger : tone === 'plain' ? colors.text : colors.brand;
  return (
    <Pressable style={[styles.actionBtn, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function DiaryComposer({
  projectId,
  entry,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  entry?: SiteDiaryEntry;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState<string | null>(entry?.entryDate ?? todayIso());
  const [weather, setWeather] = useState(entry?.weather ?? '');
  const [temperature, setTemperature] = useState(entry?.temperature != null ? String(entry.temperature) : '');
  const [labour, setLabour] = useState(entry?.labourCount != null ? String(entry.labourCount) : '');
  const [plant, setPlant] = useState(entry?.plant ?? '');
  const [deliveries, setDeliveries] = useState(entry?.deliveries ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [busy, setBusy] = useState(false);

  function intOrNull(s: string): number | null {
    const n = parseInt(s.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  async function submit() {
    if (busy) return;
    if (!date) {
      Alert.alert('Date required', 'Pick the date this entry is for.');
      return;
    }
    setBusy(true);
    try {
      await saveSiteDiaryEntry(projectId, date, {
        weather,
        temperature: intOrNull(temperature),
        labourCount: intOrNull(labour),
        plant,
        deliveries,
        notes,
      });
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen options={headerOpts(colors, entry ? 'Edit entry' : 'Log an entry')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Date</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Date" value={date} onChange={setDate} max={todayIso()} />
        </View>

        <TextInput style={styles.input} placeholder="Weather (e.g. Overcast, light rain)" placeholderTextColor={colors.subtle} value={weather} onChangeText={setWeather} />
        <View style={styles.dualRow}>
          <TextInput style={[styles.input, styles.half]} placeholder="Temp °C" placeholderTextColor={colors.subtle} value={temperature} onChangeText={setTemperature} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.half]} placeholder="Labour on site" placeholderTextColor={colors.subtle} value={labour} onChangeText={setLabour} keyboardType="number-pad" />
        </View>
        <TextInput style={styles.input} placeholder="Plant / equipment" placeholderTextColor={colors.subtle} value={plant} onChangeText={setPlant} />
        <TextInput style={styles.input} placeholder="Deliveries" placeholderTextColor={colors.subtle} value={deliveries} onChangeText={setDeliveries} />
        <TextInput style={[styles.input, styles.multiline]} placeholder="Notes" placeholderTextColor={colors.subtle} value={notes} onChangeText={setNotes} multiline />

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>{entry ? 'Save' : 'Save entry'}</Text>}
          </Pressable>
          <Pressable onPress={onCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
        {!entry ? <Text style={styles.hint}>Save the entry, then open it to attach photos.</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 14, paddingBottom: 40, ...contentWidth },
    project: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
    backText: { color: c.brand, fontFamily: font.bodySemi, fontSize: 14 },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 12 },
    addBtnText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    empty: { fontSize: 14, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    list: { gap: 2 },
    rowItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    rowBody: { flex: 1, gap: 3 },
    itemTitle: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    metaText: { fontSize: 12, fontFamily: font.body, color: c.muted },
    // Detail
    detailTitle: { fontSize: 20, fontFamily: font.displayBold, color: c.text },
    detailRow: { gap: 2 },
    detailLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.3, color: c.subtle, textTransform: 'uppercase' },
    detailValue: { fontSize: 15, fontFamily: font.body, color: c.text },
    sectionLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 6 },
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photo: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: c.sunk },
    addPhoto: { width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', gap: 2 },
    addPhotoText: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    actionsCol: { gap: 8, marginTop: 8 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.surface },
    actionBtnText: { fontSize: 15, fontFamily: font.bodySemi },
    // Composer
    input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 12, fontSize: 15, fontFamily: font.body, color: c.text },
    dualRow: { flexDirection: 'row', gap: 10 },
    half: { flex: 1 },
    multiline: { minHeight: 80, textAlignVertical: 'top' },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: { flex: 1, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
    hint: { fontSize: 12, fontFamily: font.body, color: c.subtle, textAlign: 'center' },
  });
