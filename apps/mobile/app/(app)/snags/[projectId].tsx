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
import { listProjectMembers, type Member } from '../../../lib/data/members';
import {
  listProjectSnags,
  raiseSnag,
  updateSnag,
  markSnagFixed,
  verifySnag,
  reopenSnag,
  deleteSnag,
  addSnagPhoto,
  canManageProject,
  SEVERITIES,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type Snag,
  type SnagSeverity,
} from '../../../lib/data/snags';
import { DateField } from '../../../components/date-field';
import { useSession } from '../../../lib/auth';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function severityTone(s: SnagSeverity, c: Colors): { bg: string; fg: string } {
  if (s === 'critical') return { bg: c.dangerSoft, fg: c.danger };
  if (s === 'major') return { bg: c.accentSoft, fg: c.accentDeep };
  return { bg: c.sunk, fg: c.subtle };
}
function statusTone(s: Snag['status'], c: Colors): { bg: string; fg: string } {
  if (s === 'verified') return { bg: c.successSoft, fg: c.success };
  if (s === 'fixed') return { bg: c.brandSoft, fg: c.brand };
  if (s === 'reopened' || s === 'charged') return { bg: c.dangerSoft, fg: c.danger };
  return { bg: c.sunk, fg: c.subtle };
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDue(iso: string): string {
  const [, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${mon} ${Number(d)}`;
}

export default function ProjectSnags() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { session } = useSession();
  const meId = session?.user.id ?? null;

  const [snags, setSnags] = useState<Snag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'new' | Snag | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, mem, manage] = await Promise.all([
      listProjectSnags(String(projectId)),
      listProjectMembers(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setSnags(list);
    setMembers(mem);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const detail = detailId ? snags.find((s) => s.id === detailId) ?? null : null;

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

  async function capturePhoto(snag: Snag, fromCamera: boolean) {
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
      addSnagPhoto({ snagId: snag.id, projectId: String(projectId), base64: asset.base64!, ext, mime: asset.mimeType ?? 'image/jpeg' }),
    );
  }
  function addPhoto(snag: Snag) {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => void capturePhoto(snag, true) },
      { text: 'Choose from library', onPress: () => void capturePhoto(snag, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(snag: Snag) {
    Alert.alert('Remove snag', `Remove defect #${snag.number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDetailId(null);
          void runAction(() => deleteSnag(snag.id));
        },
      },
    ]);
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  if (detail) {
    const isAssignee = detail.assigneeId === meId;
    const canFix = (isAssignee || canManage) && ['open', 'reopened'].includes(detail.status);
    const canEdit = canManage || detail.raisedById === meId;
    const sev = severityTone(detail.severity, colors);
    const st = statusTone(detail.status, colors);
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, `Defect #${detail.number}`)} />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Snags</Text>
          </Pressable>

          <Text style={styles.detailTitle}>{detail.title}</Text>
          <View style={styles.chipRow}>
            <View style={[styles.chipSmall, { backgroundColor: sev.bg }]}>
              <Text style={[styles.chipSmallText, { color: sev.fg }]}>{SEVERITY_LABEL[detail.severity]}</Text>
            </View>
            <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
              <Text style={[styles.chipSmallText, { color: st.fg }]}>{STATUS_LABEL[detail.status]}</Text>
            </View>
          </View>

          {detail.location ? <DetailRow label="Location" value={detail.location} styles={styles} /> : null}
          {detail.description ? <DetailRow label="Description" value={detail.description} styles={styles} /> : null}
          <DetailRow label="Assigned to" value={detail.assigneeName ?? 'Unassigned'} styles={styles} />
          {detail.dueDate ? <DetailRow label="Due" value={fmtDue(detail.dueDate)} styles={styles} /> : null}
          {detail.raisedByName ? <DetailRow label="Raised by" value={detail.raisedByName} styles={styles} /> : null}

          <Text style={styles.sectionLabel}>Photos</Text>
          <View style={styles.photoGrid}>
            {detail.photos.map((p) =>
              p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.photo} /> : null,
            )}
            <Pressable style={styles.addPhoto} onPress={() => addPhoto(detail)} disabled={busy}>
              <Ionicons name="camera-outline" size={22} color={colors.brand} />
              <Text style={styles.addPhotoText}>Add</Text>
            </Pressable>
          </View>

          <View style={styles.actionsCol}>
            {canFix ? (
              <ActionButton label="Mark fixed" icon="checkmark-circle-outline" onPress={() => void runAction(() => markSnagFixed(detail.id, String(projectId)))} styles={styles} colors={colors} disabled={busy} />
            ) : null}
            {canManage && detail.status === 'fixed' ? (
              <>
                <ActionButton label="Verify fix" icon="shield-checkmark-outline" onPress={() => void runAction(() => verifySnag(detail.id))} styles={styles} colors={colors} disabled={busy} />
                <ActionButton label="Reopen" icon="refresh-outline" tone="danger" onPress={() => void runAction(() => reopenSnag(detail.id, String(projectId)))} styles={styles} colors={colors} disabled={busy} />
              </>
            ) : null}
            {canManage && detail.status === 'verified' ? (
              <ActionButton label="Reopen" icon="refresh-outline" tone="danger" onPress={() => void runAction(() => reopenSnag(detail.id, String(projectId)))} styles={styles} colors={colors} disabled={busy} />
            ) : null}
            {canEdit ? (
              <>
                <ActionButton label="Edit" icon="pencil-outline" tone="plain" onPress={() => { setDetailId(null); setComposer(detail); }} styles={styles} colors={colors} disabled={busy} />
                <ActionButton label="Remove" icon="trash-outline" tone="danger" onPress={() => confirmDelete(detail)} styles={styles} colors={colors} disabled={busy} />
              </>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  if (composer) {
    return (
      <SnagComposer
        key={composer === 'new' ? 'new' : composer.id}
        projectId={String(projectId)}
        members={members}
        snag={composer === 'new' ? undefined : composer}
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
      <Stack.Screen options={headerOpts(colors, 'Snags')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
          <Ionicons name="add" size={18} color={colors.onBrand} />
          <Text style={styles.addBtnText}>Raise a defect</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : snags.length === 0 ? (
          <Text style={styles.empty}>No defects logged. Raise one to track a snag through to close-out.</Text>
        ) : (
          <View style={styles.list}>
            {snags.map((s) => {
              const sev = severityTone(s.severity, colors);
              const st = statusTone(s.status, colors);
              return (
                <Pressable key={s.id} style={styles.rowItem} onPress={() => setDetailId(s.id)}>
                  <View style={styles.rowBody}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      #{s.number} · {s.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.chipSmall, { backgroundColor: sev.bg }]}>
                        <Text style={[styles.chipSmallText, { color: sev.fg }]}>{SEVERITY_LABEL[s.severity]}</Text>
                      </View>
                      <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
                        <Text style={[styles.chipSmallText, { color: st.fg }]}>{STATUS_LABEL[s.status]}</Text>
                      </View>
                      {s.photos.length ? (
                        <Text style={styles.metaText}>
                          <Ionicons name="camera" size={11} color={colors.subtle} /> {s.photos.length}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.metaText} numberOfLines={1}>
                      {s.assigneeName ? `For ${s.assigneeName}` : 'Unassigned'}
                      {s.location ? ` · ${s.location}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
                </Pressable>
              );
            })}
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

function SnagComposer({
  projectId,
  members,
  snag,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  members: Member[];
  snag?: Snag;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(snag?.title ?? '');
  const [description, setDescription] = useState(snag?.description ?? '');
  const [location, setLocation] = useState(snag?.location ?? '');
  const [severity, setSeverity] = useState<SnagSeverity>(snag?.severity ?? 'major');
  const [assignee, setAssignee] = useState<string | null>(snag?.assigneeId ?? null);
  const [due, setDue] = useState<string | null>(snag?.dueDate ?? null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (title.trim().length < 2) {
      Alert.alert('Title required', 'Give the defect a short title.');
      return;
    }
    setBusy(true);
    try {
      if (snag) {
        await updateSnag({ id: snag.id, projectId, title, severity, description, location, assigneeId: assignee, dueDate: due });
      } else {
        await raiseSnag({ projectId, title, severity, description, location, assigneeId: assignee, dueDate: due });
      }
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen options={headerOpts(colors, snag ? 'Edit defect' : 'Raise a defect')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} placeholder="What is the defect?" placeholderTextColor={colors.subtle} value={title} onChangeText={setTitle} autoFocus />
        <TextInput style={[styles.input, styles.multiline]} placeholder="Description (optional)" placeholderTextColor={colors.subtle} value={description} onChangeText={setDescription} multiline />
        <TextInput style={styles.input} placeholder="Location (e.g. Unit 4, kitchen)" placeholderTextColor={colors.subtle} value={location} onChangeText={setLocation} />

        <Text style={styles.fieldLabel}>Severity</Text>
        <View style={styles.chips}>
          {SEVERITIES.map((s) => (
            <Pressable key={s} onPress={() => setSeverity(s)} style={[styles.chip, severity === s && styles.chipActive]}>
              <Text style={[styles.chipText, severity === s && styles.chipTextActive]}>{SEVERITY_LABEL[s]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Assign to</Text>
        <View style={styles.chips}>
          <Pressable onPress={() => setAssignee(null)} style={[styles.chip, assignee === null && styles.chipActive]}>
            <Text style={[styles.chipText, assignee === null && styles.chipTextActive]}>Unassigned</Text>
          </Pressable>
          {members.map((m) => (
            <Pressable key={m.userId} onPress={() => setAssignee(m.userId)} style={[styles.chip, assignee === m.userId && styles.chipActive]}>
              <Text style={[styles.chipText, assignee === m.userId && styles.chipTextActive]}>{m.name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Due date</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Due" value={due} onChange={setDue} min={todayIso()} />
        </View>

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>{snag ? 'Save' : 'Raise defect'}</Text>}
          </Pressable>
          <Pressable onPress={onCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
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
    itemTitle: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    metaText: { fontSize: 12, fontFamily: font.body, color: c.muted },
    chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chipSmall: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipSmallText: { fontSize: 11, fontFamily: font.bodySemi },
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
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted },
    chipTextActive: { color: c.bg },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: { flex: 1, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
  });
