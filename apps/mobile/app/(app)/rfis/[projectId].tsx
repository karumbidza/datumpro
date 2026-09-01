import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { listProjectMembers, type Member } from '../../../lib/data/members';
import {
  listProjectRfis,
  raiseRfi,
  updateRfi,
  answerRfi,
  closeRfi,
  reopenRfi,
  deleteRfi,
  addRfiAttachment,
  canManageProject,
  PRIORITIES,
  DISCIPLINES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  DISCIPLINE_LABEL,
  type Rfi,
  type RfiPriority,
  type Discipline,
} from '../../../lib/data/rfis';
import { DateField } from '../../../components/date-field';
import { useSession } from '../../../lib/auth';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function priorityTone(p: RfiPriority, c: Colors): { bg: string; fg: string } | null {
  if (p === 'urgent') return { bg: c.dangerSoft, fg: c.danger };
  if (p === 'high') return { bg: c.accentSoft, fg: c.accentDeep };
  if (p === 'low') return { bg: c.sunk, fg: c.subtle };
  return null;
}
function statusTone(s: Rfi['status'], c: Colors): { bg: string; fg: string } {
  if (s === 'answered') return { bg: c.brandSoft, fg: c.brand };
  if (s === 'closed') return { bg: c.successSoft, fg: c.success };
  if (s === 'reopened') return { bg: c.dangerSoft, fg: c.danger };
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

export default function ProjectRfis() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { session } = useSession();
  const meId = session?.user.id ?? null;

  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'new' | Rfi | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answerText, setAnswerText] = useState('');

  const load = useCallback(async () => {
    const [list, mem, manage] = await Promise.all([
      listProjectRfis(String(projectId)),
      listProjectMembers(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setRfis(list);
    setMembers(mem);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Clear the draft answer whenever the open RFI changes, so a half-typed answer
  // for one RFI never carries into another.
  useEffect(() => setAnswerText(''), [detailId]);

  const detail = detailId ? rfis.find((r) => r.id === detailId) ?? null : null;

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

  async function capturePhoto(rfi: Rfi, fromCamera: boolean) {
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
      addRfiAttachment({ rfiId: rfi.id, projectId: String(projectId), base64: asset.base64!, ext, mime: asset.mimeType ?? 'image/jpeg' }),
    );
  }
  function addPhoto(rfi: Rfi) {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => void capturePhoto(rfi, true) },
      { text: 'Choose from library', onPress: () => void capturePhoto(rfi, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(rfi: Rfi) {
    Alert.alert('Remove RFI', `Remove RFI #${rfi.number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDetailId(null);
          void runAction(() => deleteRfi(rfi.id));
        },
      },
    ]);
  }

  async function submitAnswer(rfi: Rfi) {
    if (answerText.trim().length < 2) {
      Alert.alert('Answer required', 'Write an answer before submitting.');
      return;
    }
    await runAction(() => answerRfi(rfi.id, String(projectId), answerText));
    setAnswerText('');
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (detail) {
    const isAssignee = detail.assigneeId === meId;
    const isRaiser = detail.raisedById === meId;
    const canAnswer = (isAssignee || canManage) && ['open', 'reopened'].includes(detail.status);
    const canClose = (isRaiser || canManage) && detail.status === 'answered';
    const canReopen = (isRaiser || canManage) && ['answered', 'closed'].includes(detail.status);
    const canEdit = canManage || isRaiser;
    const pri = priorityTone(detail.priority, colors);
    const st = statusTone(detail.status, colors);
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, `RFI #${detail.number}`)} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.brand} />
              <Text style={styles.backText}>RFIs</Text>
            </Pressable>

            <Text style={styles.detailTitle}>{detail.subject}</Text>
            <View style={styles.chipRow}>
              <View style={[styles.chipSmall, { backgroundColor: colors.sunk }]}>
                <Text style={[styles.chipSmallText, { color: colors.subtle }]}>{DISCIPLINE_LABEL[detail.discipline]}</Text>
              </View>
              {pri ? (
                <View style={[styles.chipSmall, { backgroundColor: pri.bg }]}>
                  <Text style={[styles.chipSmallText, { color: pri.fg }]}>{PRIORITY_LABEL[detail.priority]}</Text>
                </View>
              ) : null}
              <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
                <Text style={[styles.chipSmallText, { color: st.fg }]}>{STATUS_LABEL[detail.status]}</Text>
              </View>
            </View>

            {detail.detail ? <DetailRow label="Question" value={detail.detail} styles={styles} /> : null}
            <DetailRow label="Responder" value={detail.assigneeName ?? 'Unassigned'} styles={styles} />
            {detail.dueDate ? <DetailRow label="Needed by" value={fmtDue(detail.dueDate)} styles={styles} /> : null}
            {detail.raisedByName ? <DetailRow label="Raised by" value={detail.raisedByName} styles={styles} /> : null}

            {detail.answer ? (
              <View style={styles.answerBox}>
                <Text style={styles.detailLabel}>ANSWER{detail.answeredByName ? ` · ${detail.answeredByName}` : ''}</Text>
                <Text style={styles.detailValue}>{detail.answer}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Attachments</Text>
            <View style={styles.photoGrid}>
              {detail.attachments.map((a) => (a.url ? <Image key={a.id} source={{ uri: a.url }} style={styles.photo} /> : null))}
              <Pressable style={styles.addPhoto} onPress={() => addPhoto(detail)} disabled={busy}>
                <Ionicons name="camera-outline" size={22} color={colors.brand} />
                <Text style={styles.addPhotoText}>Add</Text>
              </Pressable>
            </View>

            {canAnswer ? (
              <View style={styles.answerCompose}>
                <Text style={styles.sectionLabel}>Answer this RFI</Text>
                <TextInput style={[styles.input, styles.multiline]} placeholder="Write your response…" placeholderTextColor={colors.subtle} value={answerText} onChangeText={setAnswerText} multiline />
                <Pressable style={[styles.submit, busy && styles.disabled]} onPress={() => void submitAnswer(detail)} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>Submit answer</Text>}
                </Pressable>
              </View>
            ) : null}

            <View style={styles.actionsCol}>
              {canClose ? (
                <ActionButton label="Close RFI" icon="checkmark-circle-outline" onPress={() => void runAction(() => closeRfi(detail.id))} styles={styles} colors={colors} disabled={busy} />
              ) : null}
              {canReopen ? (
                <ActionButton label="Reopen" icon="refresh-outline" tone="danger" onPress={() => void runAction(() => reopenRfi(detail.id, String(projectId)))} styles={styles} colors={colors} disabled={busy} />
              ) : null}
              {canEdit ? (
                <>
                  <ActionButton label="Edit" icon="pencil-outline" tone="plain" onPress={() => { setDetailId(null); setComposer(detail); }} styles={styles} colors={colors} disabled={busy} />
                  <ActionButton label="Remove" icon="trash-outline" tone="danger" onPress={() => confirmDelete(detail)} styles={styles} colors={colors} disabled={busy} />
                </>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  if (composer) {
    return (
      <RfiComposer
        key={composer === 'new' ? 'new' : composer.id}
        projectId={String(projectId)}
        members={members}
        rfi={composer === 'new' ? undefined : composer}
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
      <Stack.Screen options={headerOpts(colors, 'RFIs')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
          <Ionicons name="add" size={18} color={colors.onBrand} />
          <Text style={styles.addBtnText}>Raise an RFI</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : rfis.length === 0 ? (
          <Text style={styles.empty}>No RFIs yet. Raise one to get a formal answer to a site question.</Text>
        ) : (
          <View style={styles.list}>
            {rfis.map((r) => {
              const pri = priorityTone(r.priority, colors);
              const st = statusTone(r.status, colors);
              return (
                <Pressable key={r.id} style={styles.rowItem} onPress={() => setDetailId(r.id)}>
                  <View style={styles.rowBody}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      #{r.number} · {r.subject}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.chipSmall, { backgroundColor: colors.sunk }]}>
                        <Text style={[styles.chipSmallText, { color: colors.subtle }]}>{DISCIPLINE_LABEL[r.discipline]}</Text>
                      </View>
                      {pri ? (
                        <View style={[styles.chipSmall, { backgroundColor: pri.bg }]}>
                          <Text style={[styles.chipSmallText, { color: pri.fg }]}>{PRIORITY_LABEL[r.priority]}</Text>
                        </View>
                      ) : null}
                      <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
                        <Text style={[styles.chipSmallText, { color: st.fg }]}>{STATUS_LABEL[r.status]}</Text>
                      </View>
                    </View>
                    <Text style={styles.metaText} numberOfLines={1}>
                      {r.assigneeName ? `For ${r.assigneeName}` : 'Unassigned'}
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

function RfiComposer({
  projectId,
  members,
  rfi,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  members: Member[];
  rfi?: Rfi;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [subject, setSubject] = useState(rfi?.subject ?? '');
  const [detail, setDetail] = useState(rfi?.detail ?? '');
  const [discipline, setDiscipline] = useState<Discipline>(rfi?.discipline ?? 'architectural');
  const [priority, setPriority] = useState<RfiPriority>(rfi?.priority ?? 'medium');
  const [assignee, setAssignee] = useState<string | null>(rfi?.assigneeId ?? null);
  const [due, setDue] = useState<string | null>(rfi?.dueDate ?? null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (subject.trim().length < 2) {
      Alert.alert('Subject required', 'Give the RFI a short subject.');
      return;
    }
    setBusy(true);
    try {
      if (rfi) {
        await updateRfi({ id: rfi.id, projectId, subject, detail, discipline, priority, assigneeId: assignee, dueDate: due });
      } else {
        await raiseRfi({ projectId, subject, detail, discipline, priority, assigneeId: assignee, dueDate: due });
      }
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={headerOpts(colors, rfi ? 'Edit RFI' : 'Raise an RFI')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} placeholder="Subject" placeholderTextColor={colors.subtle} value={subject} onChangeText={setSubject} autoFocus />
        <TextInput style={[styles.input, styles.multiline]} placeholder="The question / detail" placeholderTextColor={colors.subtle} value={detail} onChangeText={setDetail} multiline />

        <Text style={styles.fieldLabel}>Discipline</Text>
        <View style={styles.chips}>
          {DISCIPLINES.map((d) => (
            <Pressable key={d} onPress={() => setDiscipline(d)} style={[styles.chip, discipline === d && styles.chipActive]}>
              <Text style={[styles.chipText, discipline === d && styles.chipTextActive]}>{DISCIPLINE_LABEL[d]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Priority</Text>
        <View style={styles.chips}>
          {PRIORITIES.map((p) => (
            <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipActive]}>
              <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{PRIORITY_LABEL[p]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Responder</Text>
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

        <Text style={styles.fieldLabel}>Needed by</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Due" value={due} onChange={setDue} min={todayIso()} />
        </View>

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>{rfi ? 'Save' : 'Raise RFI'}</Text>}
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
    answerBox: { backgroundColor: c.brandSoft, borderRadius: radius.sm, padding: 12, gap: 4 },
    answerCompose: { gap: 8, marginTop: 4 },
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
    multiline: { minHeight: 80, textAlignVertical: 'top' },
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
