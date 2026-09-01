import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  listProjectSiteReports,
  createSiteReport,
  submitSiteReport,
  deleteSiteReport,
  addReportPhoto,
  canManageProject,
  WEATHER_OPTIONS,
  WEATHER_LABEL,
  type SiteReport,
  type Weather,
} from '../../../lib/data/site-reports';
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

export default function ProjectReports() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { session } = useSession();
  const meId = session?.user.id ?? null;

  const [reports, setReports] = useState<SiteReport[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, manage] = await Promise.all([
      listProjectSiteReports(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setReports(list);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const detail = detailId ? reports.find((r) => r.id === detailId) ?? null : null;

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

  async function capturePhoto(report: SiteReport, fromCamera: boolean) {
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
      addReportPhoto({ reportId: report.id, projectId: String(projectId), base64: asset.base64!, ext, mime: asset.mimeType ?? 'image/jpeg' }),
    );
  }
  function addPhoto(report: SiteReport) {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => void capturePhoto(report, true) },
      { text: 'Choose from library', onPress: () => void capturePhoto(report, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(report: SiteReport) {
    Alert.alert('Remove report', `Remove the ${fmtDate(report.reportDate)} report?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDetailId(null);
          void runAction(() => deleteSiteReport(report.id));
        },
      },
    ]);
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (detail) {
    const canAct = canManage || detail.authorId === meId;
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, fmtDate(detail.reportDate))} />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Site reports</Text>
          </Pressable>

          <View style={styles.rowTop}>
            <Text style={styles.detailTitle}>{fmtDate(detail.reportDate)}</Text>
            <View style={[styles.chipSmall, { backgroundColor: detail.status === 'submitted' ? colors.successSoft : colors.sunk }]}>
              <Text style={[styles.chipSmallText, { color: detail.status === 'submitted' ? colors.success : colors.subtle }]}>
                {detail.status}
              </Text>
            </View>
          </View>

          <DetailRow label="Progress" value={`${detail.progressPct}% complete`} styles={styles} />
          {detail.weather ? <DetailRow label="Weather" value={WEATHER_LABEL[detail.weather]} styles={styles} /> : null}
          {detail.narrative ? <DetailRow label="Narrative" value={detail.narrative} styles={styles} /> : null}
          {detail.authorName ? <DetailRow label="By" value={detail.authorName} styles={styles} /> : null}

          <Text style={styles.sectionLabel}>Photos</Text>
          <View style={styles.photoGrid}>
            {detail.photos.map((p) => (p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.photo} /> : null))}
            {canAct ? (
              <Pressable style={styles.addPhoto} onPress={() => addPhoto(detail)} disabled={busy}>
                <Ionicons name="camera-outline" size={22} color={colors.brand} />
                <Text style={styles.addPhotoText}>Add</Text>
              </Pressable>
            ) : null}
          </View>

          {(detail.status === 'draft' && canAct) || canManage ? (
            <View style={styles.actionsCol}>
              {detail.status === 'draft' && canAct ? (
                <ActionButton label="Submit report" icon="send-outline" onPress={() => void runAction(() => submitSiteReport(detail.id))} styles={styles} colors={colors} disabled={busy} />
              ) : null}
              {canManage ? (
                <ActionButton label="Remove" icon="trash-outline" tone="danger" onPress={() => confirmDelete(detail)} styles={styles} colors={colors} disabled={busy} />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  if (composerOpen) {
    return (
      <ReportComposer
        projectId={String(projectId)}
        styles={styles}
        colors={colors}
        onCancel={() => setComposerOpen(false)}
        onDone={() => {
          setComposerOpen(false);
          void load();
        }}
      />
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOpts(colors, 'Site reports')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        <Pressable style={styles.addBtn} onPress={() => setComposerOpen(true)}>
          <Ionicons name="add" size={18} color={colors.onBrand} />
          <Text style={styles.addBtnText}>New report</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : reports.length === 0 ? (
          <Text style={styles.empty}>No site reports yet. Log today’s progress, weather and photos from site.</Text>
        ) : (
          <View style={styles.list}>
            {reports.map((r) => (
              <Pressable key={r.id} style={styles.rowItem} onPress={() => setDetailId(r.id)}>
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.itemTitle}>{fmtDate(r.reportDate)}</Text>
                    <View style={[styles.chipSmall, { backgroundColor: r.status === 'submitted' ? colors.successSoft : colors.sunk }]}>
                      <Text style={[styles.chipSmallText, { color: r.status === 'submitted' ? colors.success : colors.subtle }]}>{r.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {r.progressPct}% complete
                    {r.weather ? ` · ${WEATHER_LABEL[r.weather]}` : ''}
                    {r.photos.length ? ` · ${r.photos.length} photo${r.photos.length === 1 ? '' : 's'}` : ''}
                    {r.authorName ? ` · ${r.authorName}` : ''}
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
  tone?: 'brand' | 'danger';
}) {
  const color = tone === 'danger' ? colors.danger : colors.brand;
  return (
    <Pressable style={[styles.actionBtn, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ReportComposer({
  projectId,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState<string | null>(todayIso());
  const [progress, setProgress] = useState('');
  const [weather, setWeather] = useState<Weather | null>(null);
  const [narrative, setNarrative] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(status: 'draft' | 'submitted') {
    if (busy) return;
    if (!date) {
      Alert.alert('Date required', 'Pick the report date.');
      return;
    }
    const pct = parseInt(progress.trim(), 10);
    setBusy(true);
    try {
      await createSiteReport({
        projectId,
        reportDate: date,
        progressPct: Number.isNaN(pct) ? 0 : pct,
        narrative,
        weather,
        status,
      });
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={headerOpts(colors, 'New site report')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Report date</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Date" value={date} onChange={setDate} max={todayIso()} />
        </View>

        <Text style={styles.fieldLabel}>Progress % complete</Text>
        <TextInput style={styles.input} placeholder="0–100" placeholderTextColor={colors.subtle} value={progress} onChangeText={setProgress} keyboardType="number-pad" maxLength={3} />

        <Text style={styles.fieldLabel}>Weather</Text>
        <View style={styles.chips}>
          {WEATHER_OPTIONS.map((w) => (
            <Pressable key={w} onPress={() => setWeather(weather === w ? null : w)} style={[styles.chip, weather === w && styles.chipActive]}>
              <Text style={[styles.chipText, weather === w && styles.chipTextActive]}>{WEATHER_LABEL[w]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Narrative</Text>
        <TextInput style={[styles.input, styles.multiline]} placeholder="What happened on site today…" placeholderTextColor={colors.subtle} value={narrative} onChangeText={setNarrative} multiline />

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={() => save('submitted')} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>Submit</Text>}
          </Pressable>
          <Pressable style={[styles.draftBtn, busy && styles.disabled]} onPress={() => save('draft')} disabled={busy}>
            <Text style={styles.draftText}>Save draft</Text>
          </Pressable>
        </View>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.hint}>Save the report, then open it to attach site photos.</Text>
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
    rowBody: { flex: 1, gap: 4 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    itemTitle: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    metaText: { fontSize: 12, fontFamily: font.body, color: c.muted },
    chipSmall: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipSmallText: { fontSize: 11, fontFamily: font.bodySemi, textTransform: 'capitalize' },
    // Detail
    detailTitle: { fontSize: 20, fontFamily: font.displayBold, color: c.text, flex: 1 },
    detailRow: { gap: 2 },
    detailLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.3, color: c.subtle, textTransform: 'uppercase' },
    detailValue: { fontSize: 15, fontFamily: font.body, color: c.text },
    sectionLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 6 },
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photo: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: c.sunk },
    addPhoto: { width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', gap: 2 },
    addPhotoText: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    actionsCol: { gap: 8, marginTop: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.surface },
    actionBtnText: { fontSize: 15, fontFamily: font.bodySemi },
    // Composer
    input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 12, fontSize: 15, fontFamily: font.body, color: c.text },
    multiline: { minHeight: 90, textAlignVertical: 'top' },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted },
    chipTextActive: { color: c.bg },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: { flex: 1, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
    draftBtn: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', backgroundColor: c.surface },
    draftText: { color: c.text, fontFamily: font.bodySemi, fontSize: 15 },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { alignItems: 'center', paddingVertical: 8 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
    hint: { fontSize: 12, fontFamily: font.body, color: c.subtle, textAlign: 'center' },
  });
