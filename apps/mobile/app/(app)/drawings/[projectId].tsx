import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  listProjectDrawings,
  createDrawing,
  addRevision,
  updateRevisionStatus,
  updateDrawing,
  deleteRevision,
  deleteDrawing,
  canManageProject,
  DISCIPLINES,
  REVISION_STATUSES,
  DISCIPLINE_LABEL,
  STATUS_LABEL,
  type Drawing,
  type Discipline,
  type RevisionStatus,
  type PickedPdf,
} from '../../../lib/data/drawings';
import { DateField } from '../../../components/date-field';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function statusTone(s: RevisionStatus, c: Colors): { bg: string; fg: string } {
  if (s === 'for_construction') return { bg: c.successSoft, fg: c.success };
  if (s === 'superseded') return { bg: c.sunk, fg: c.subtle };
  if (s === 'as_built') return { bg: c.brandSoft, fg: c.brand };
  return { bg: c.accentSoft, fg: c.accentDeep };
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
async function pickPdf(): Promise<PickedPdf | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled) return null;
  const asset = res.assets[0];
  if (!asset) return null;
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const ext = (asset.name.split('.').pop() || 'pdf').toLowerCase();
  return { base64, ext, filename: asset.name };
}

export default function ProjectDrawings() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'new' | Drawing | null>(null);
  const [revFor, setRevFor] = useState<Drawing | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, manage] = await Promise.all([listProjectDrawings(String(projectId)), canManageProject(String(projectId))]);
    setDrawings(list);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const detail = detailId ? drawings.find((d) => d.id === detailId) ?? null : null;

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

  function changeStatus(revisionId: string) {
    Alert.alert('Set revision status', undefined, [
      ...REVISION_STATUSES.map((s) => ({ text: STATUS_LABEL[s], onPress: () => void runAction(() => updateRevisionStatus(revisionId, s)) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
  function confirmDeleteRevision(revisionId: string) {
    Alert.alert('Remove revision', 'Remove this revision?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void runAction(() => deleteRevision(revisionId)) },
    ]);
  }
  function confirmDeleteDrawing(d: Drawing) {
    Alert.alert('Remove drawing', `Remove ${d.number} and all its revisions?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDetailId(null);
          void runAction(() => deleteDrawing(d.id));
        },
      },
    ]);
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (detail) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, detail.number)} />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Drawings</Text>
          </Pressable>

          <Text style={styles.detailTitle}>{detail.number}</Text>
          <Text style={styles.detailSub}>{detail.title}</Text>
          <View style={styles.chipRow}>
            <View style={[styles.chipSmall, { backgroundColor: colors.sunk }]}>
              <Text style={[styles.chipSmallText, { color: colors.subtle }]}>{DISCIPLINE_LABEL[detail.discipline]}</Text>
            </View>
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>Revisions</Text>
            {canManage ? (
              <Pressable onPress={() => setRevFor(detail)} hitSlop={8}>
                <Text style={styles.addRevText}>+ Add revision</Text>
              </Pressable>
            ) : null}
          </View>

          {detail.revisions.map((r) => {
            const st = statusTone(r.status, colors);
            return (
              <View key={r.id} style={styles.revRow}>
                <View style={styles.revHead}>
                  <Text style={styles.revLabel}>Rev {r.revision}</Text>
                  <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
                    <Text style={[styles.chipSmallText, { color: st.fg }]}>{STATUS_LABEL[r.status]}</Text>
                  </View>
                  {r.issueDate ? <Text style={styles.revDate}>{r.issueDate}</Text> : null}
                </View>
                <View style={styles.revActions}>
                  {r.url ? (
                    <Pressable style={styles.revBtn} onPress={() => Linking.openURL(r.url!)}>
                      <Ionicons name="document-text-outline" size={15} color={colors.brand} />
                      <Text style={styles.revBtnText}>Open PDF</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.revNoPdf}>No PDF</Text>
                  )}
                  {canManage ? (
                    <>
                      <Pressable style={styles.revBtn} onPress={() => changeStatus(r.id)} disabled={busy}>
                        <Ionicons name="swap-horizontal-outline" size={15} color={colors.muted} />
                        <Text style={[styles.revBtnText, { color: colors.muted }]}>Status</Text>
                      </Pressable>
                      <Pressable style={styles.revBtn} onPress={() => confirmDeleteRevision(r.id)} disabled={busy} hitSlop={6}>
                        <Ionicons name="trash-outline" size={15} color={colors.subtle} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}

          {canManage ? (
            <View style={styles.actionsCol}>
              <ActionButton label="Edit drawing" icon="pencil-outline" tone="plain" onPress={() => { setDetailId(null); setComposer(detail); }} styles={styles} colors={colors} disabled={busy} />
              <ActionButton label="Remove drawing" icon="trash-outline" tone="danger" onPress={() => confirmDeleteDrawing(detail)} styles={styles} colors={colors} disabled={busy} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ── Add-revision form ────────────────────────────────────────────────────
  if (revFor) {
    return (
      <RevisionForm
        drawing={revFor}
        projectId={String(projectId)}
        styles={styles}
        colors={colors}
        onCancel={() => setRevFor(null)}
        onDone={() => {
          setRevFor(null);
          void load();
        }}
      />
    );
  }

  // ── Composer (new / edit drawing) ────────────────────────────────────────
  if (composer) {
    return (
      <DrawingComposer
        key={composer === 'new' ? 'new' : composer.id}
        projectId={String(projectId)}
        drawing={composer === 'new' ? undefined : composer}
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
      <Stack.Screen options={headerOpts(colors, 'Drawings')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        {canManage ? (
          <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
            <Ionicons name="add" size={18} color={colors.onBrand} />
            <Text style={styles.addBtnText}>Add a drawing</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : drawings.length === 0 ? (
          <Text style={styles.empty}>No drawings yet. Add a sheet with its first revision.</Text>
        ) : (
          <View style={styles.list}>
            {drawings.map((d) => {
              const st = d.current ? statusTone(d.current.status, colors) : null;
              return (
                <Pressable key={d.id} style={styles.rowItem} onPress={() => setDetailId(d.id)}>
                  <View style={styles.rowBody}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {d.number} · {d.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.chipSmall, { backgroundColor: colors.sunk }]}>
                        <Text style={[styles.chipSmallText, { color: colors.subtle }]}>{DISCIPLINE_LABEL[d.discipline]}</Text>
                      </View>
                      {d.current && st ? (
                        <View style={[styles.chipSmall, { backgroundColor: st.bg }]}>
                          <Text style={[styles.chipSmallText, { color: st.fg }]}>
                            Rev {d.current.revision} · {STATUS_LABEL[d.current.status]}
                          </Text>
                        </View>
                      ) : null}
                    </View>
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

function PdfPicker({ pdf, onPick, styles, colors }: { pdf: PickedPdf | null; onPick: (p: PickedPdf | null) => void; styles: ReturnType<typeof makeStyles>; colors: Colors }) {
  return (
    <Pressable
      style={styles.pdfPick}
      onPress={async () => {
        try {
          const picked = await pickPdf();
          if (picked) onPick(picked);
        } catch {
          Alert.alert('Could not read the file', 'Please try another PDF.');
        }
      }}
    >
      <Ionicons name="document-attach-outline" size={18} color={colors.brand} />
      <Text style={styles.pdfPickText} numberOfLines={1}>
        {pdf ? pdf.filename : 'Choose PDF (optional)'}
      </Text>
      {pdf ? (
        <Pressable onPress={() => onPick(null)} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={colors.subtle} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function StatusChips({ status, onChange, styles }: { status: RevisionStatus; onChange: (s: RevisionStatus) => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.chips}>
      {REVISION_STATUSES.map((s) => (
        <Pressable key={s} onPress={() => onChange(s)} style={[styles.chip, status === s && styles.chipActive]}>
          <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{STATUS_LABEL[s]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function DrawingComposer({
  projectId,
  drawing,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  drawing?: Drawing;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [number, setNumber] = useState(drawing?.number ?? '');
  const [title, setTitle] = useState(drawing?.title ?? '');
  const [discipline, setDiscipline] = useState<Discipline>(drawing?.discipline ?? 'architectural');
  const [revision, setRevision] = useState('A');
  const [status, setStatus] = useState<RevisionStatus>('for_review');
  const [issueDate, setIssueDate] = useState<string | null>(todayIso());
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (number.trim().length < 1 || title.trim().length < 2) {
      Alert.alert('Number and title required', 'Give the drawing a number and a title.');
      return;
    }
    setBusy(true);
    try {
      if (drawing) {
        await updateDrawing({ id: drawing.id, number, title, discipline });
      } else {
        await createDrawing({ projectId, number, title, discipline, revision, status, issueDate, pdf });
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
      <Stack.Screen options={headerOpts(colors, drawing ? 'Edit drawing' : 'Add a drawing')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} placeholder="Drawing number (e.g. A-101)" placeholderTextColor={colors.subtle} value={number} onChangeText={setNumber} autoFocus autoCapitalize="characters" />
        <TextInput style={styles.input} placeholder="Title" placeholderTextColor={colors.subtle} value={title} onChangeText={setTitle} />

        <Text style={styles.fieldLabel}>Discipline</Text>
        <View style={styles.chips}>
          {DISCIPLINES.map((d) => (
            <Pressable key={d} onPress={() => setDiscipline(d)} style={[styles.chip, discipline === d && styles.chipActive]}>
              <Text style={[styles.chipText, discipline === d && styles.chipTextActive]}>{DISCIPLINE_LABEL[d]}</Text>
            </Pressable>
          ))}
        </View>

        {!drawing ? (
          <>
            <Text style={styles.fieldLabel}>First revision</Text>
            <TextInput style={styles.input} placeholder="Revision (e.g. A)" placeholderTextColor={colors.subtle} value={revision} onChangeText={setRevision} autoCapitalize="characters" />
            <StatusChips status={status} onChange={setStatus} styles={styles} />
            <Text style={styles.fieldLabel}>Issue date</Text>
            <View style={{ flexDirection: 'row' }}>
              <DateField label="Issued" value={issueDate} onChange={setIssueDate} max={todayIso()} />
            </View>
            <PdfPicker pdf={pdf} onPick={setPdf} styles={styles} colors={colors} />
          </>
        ) : null}

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>{drawing ? 'Save' : 'Add drawing'}</Text>}
          </Pressable>
          <Pressable onPress={onCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RevisionForm({
  drawing,
  projectId,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  drawing: Drawing;
  projectId: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [revision, setRevision] = useState('');
  const [status, setStatus] = useState<RevisionStatus>('for_review');
  const [issueDate, setIssueDate] = useState<string | null>(todayIso());
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!revision.trim()) {
      Alert.alert('Revision label required', 'Give the revision a label (e.g. B).');
      return;
    }
    setBusy(true);
    try {
      await addRevision({ drawingId: drawing.id, projectId, revision, status, issueDate, pdf });
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={headerOpts(colors, `${drawing.number} · new revision`)} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Issuing a new revision supersedes the current sheet.</Text>
        <TextInput style={styles.input} placeholder="Revision (e.g. B)" placeholderTextColor={colors.subtle} value={revision} onChangeText={setRevision} autoFocus autoCapitalize="characters" />
        <Text style={styles.fieldLabel}>Status</Text>
        <StatusChips status={status} onChange={setStatus} styles={styles} />
        <Text style={styles.fieldLabel}>Issue date</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Issued" value={issueDate} onChange={setIssueDate} max={todayIso()} />
        </View>
        <PdfPicker pdf={pdf} onPick={setPdf} styles={styles} colors={colors} />

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>Issue revision</Text>}
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
    chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chipSmall: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipSmallText: { fontSize: 11, fontFamily: font.bodySemi },
    // Detail
    detailTitle: { fontSize: 20, fontFamily: font.displayBold, color: c.text },
    detailSub: { fontSize: 15, fontFamily: font.body, color: c.muted, marginTop: -6 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    sectionLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text },
    addRevText: { fontSize: 13, fontFamily: font.bodySemi, color: c.brand },
    revRow: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    revHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    revLabel: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    revDate: { fontSize: 12, color: c.subtle, marginLeft: 'auto' },
    revActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    revBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    revBtnText: { fontSize: 13, fontFamily: font.bodySemi, color: c.brand },
    revNoPdf: { fontSize: 13, color: c.subtle },
    actionsCol: { gap: 8, marginTop: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.surface },
    actionBtnText: { fontSize: 15, fontFamily: font.bodySemi },
    // Composer
    input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 12, fontSize: 15, fontFamily: font.body, color: c.text },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    hint: { fontSize: 13, fontFamily: font.body, color: c.subtle },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted },
    chipTextActive: { color: c.bg },
    pdfPick: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed', borderRadius: radius.sm, padding: 12, backgroundColor: c.surface },
    pdfPickText: { flex: 1, fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: { flex: 1, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
  });
