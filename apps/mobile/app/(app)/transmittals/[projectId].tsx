import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { listProjectMembers, type Member } from '../../../lib/data/members';
import {
  listProjectTransmittals,
  listIssuableDrawings,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
  canManageProject,
  PURPOSES,
  METHODS,
  PURPOSE_LABEL,
  METHOD_LABEL,
  type Transmittal,
  type TransmittalPurpose,
  type TransmittalMethod,
  type IssuableDrawing,
} from '../../../lib/data/transmittals';
import { DateField } from '../../../components/date-field';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function trNo(n: number): string {
  return `TR-${String(n).padStart(3, '0')}`;
}

export default function ProjectTransmittals() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [transmittals, setTransmittals] = useState<Transmittal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [issuable, setIssuable] = useState<IssuableDrawing[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'new' | Transmittal | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, mem, draws, manage] = await Promise.all([
      listProjectTransmittals(String(projectId)),
      listProjectMembers(String(projectId)),
      listIssuableDrawings(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setTransmittals(list);
    setMembers(mem);
    setIssuable(draws);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const detail = detailId ? transmittals.find((t) => t.id === detailId) ?? null : null;

  function confirmDelete(t: Transmittal) {
    Alert.alert('Remove transmittal', `Remove ${trNo(t.number)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDetailId(null);
          setBusy(true);
          try {
            await deleteTransmittal(t.id);
            await load();
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (detail) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={headerOpts(colors, trNo(detail.number))} />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetailId(null)} style={styles.back} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Transmittals</Text>
          </Pressable>

          <Text style={styles.detailTitle}>{trNo(detail.number)}</Text>
          <DetailRow label="To" value={detail.recipient} styles={styles} />
          <DetailRow label="Purpose" value={PURPOSE_LABEL[detail.purpose]} styles={styles} />
          <DetailRow label="Method" value={METHOD_LABEL[detail.method]} styles={styles} />
          <DetailRow label="Issued" value={detail.issuedDate} styles={styles} />
          {detail.issuedByName ? <DetailRow label="Issued by" value={detail.issuedByName} styles={styles} /> : null}
          {detail.notes ? <DetailRow label="Notes" value={detail.notes} styles={styles} /> : null}

          <Text style={styles.sectionLabel}>Drawings transmitted ({detail.items.length})</Text>
          <View style={styles.itemList}>
            {detail.items.map((it) => (
              <View key={it.id} style={styles.itemRow}>
                <Ionicons name="document-outline" size={16} color={colors.subtle} />
                <Text style={styles.itemText} numberOfLines={2}>
                  {it.drawingNumber}
                  {it.revision ? ` Rev ${it.revision}` : ''}
                  {it.title ? ` — ${it.title}` : ''}
                </Text>
              </View>
            ))}
          </View>

          {canManage ? (
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
      <TransmittalComposer
        key={composer === 'new' ? 'new' : composer.id}
        projectId={String(projectId)}
        members={members}
        issuable={issuable}
        transmittal={composer === 'new' ? undefined : composer}
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
      <Stack.Screen options={headerOpts(colors, 'Transmittals')} />
      <ScrollView contentContainerStyle={styles.content}>
        {name ? <Text style={styles.project}>{name}</Text> : null}
        {canManage ? (
          <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
            <Ionicons name="add" size={18} color={colors.onBrand} />
            <Text style={styles.addBtnText}>New transmittal</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : transmittals.length === 0 ? (
          <Text style={styles.empty}>No transmittals yet. Issue drawings to a recipient and keep a record.</Text>
        ) : (
          <View style={styles.list}>
            {transmittals.map((t) => (
              <Pressable key={t.id} style={styles.rowItem} onPress={() => setDetailId(t.id)}>
                <View style={styles.rowBody}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {trNo(t.number)} · {t.recipient}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.chipSmall, { backgroundColor: colors.sunk }]}>
                      <Text style={[styles.chipSmallText, { color: colors.subtle }]}>{PURPOSE_LABEL[t.purpose]}</Text>
                    </View>
                    <Text style={styles.metaText}>
                      {t.items.length} drawing{t.items.length === 1 ? '' : 's'} · {t.issuedDate}
                    </Text>
                  </View>
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

function TransmittalComposer({
  projectId,
  members,
  issuable,
  transmittal,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  members: Member[];
  issuable: IssuableDrawing[];
  transmittal?: Transmittal;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [recipient, setRecipient] = useState(transmittal?.recipient ?? '');
  const [recipientUserId, setRecipientUserId] = useState<string | null>(transmittal?.recipientUserId ?? null);
  const [purpose, setPurpose] = useState<TransmittalPurpose>(transmittal?.purpose ?? 'for_construction');
  const [method, setMethod] = useState<TransmittalMethod>(transmittal?.method ?? 'email');
  const [issued, setIssued] = useState<string | null>(transmittal?.issuedDate ?? todayIso());
  const [notes, setNotes] = useState(transmittal?.notes ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  function toggle(revisionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(revisionId)) next.delete(revisionId);
      else next.add(revisionId);
      return next;
    });
  }

  async function submit() {
    if (busy) return;
    if (recipient.trim().length < 2) {
      Alert.alert('Recipient required', 'Who is it going to?');
      return;
    }
    if (!issued) {
      Alert.alert('Date required', 'Pick the issue date.');
      return;
    }
    if (!transmittal && selected.size === 0) {
      Alert.alert('Add drawings', 'Select at least one drawing to transmit.');
      return;
    }
    setBusy(true);
    try {
      if (transmittal) {
        await updateTransmittal({ id: transmittal.id, recipient, recipientUserId, purpose, method, issuedDate: issued, notes });
      } else {
        const chosen = issuable.filter((d) => selected.has(d.revisionId));
        await createTransmittal({ projectId, recipient, recipientUserId, purpose, method, issuedDate: issued, notes, drawings: chosen });
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
      <Stack.Screen options={headerOpts(colors, transmittal ? 'Edit transmittal' : 'New transmittal')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} placeholder="Recipient (name or company)" placeholderTextColor={colors.subtle} value={recipient} onChangeText={setRecipient} autoFocus />
        {members.length > 0 ? (
          <>
            <Text style={styles.fieldLabel}>Link to a member (optional)</Text>
            <View style={styles.chips}>
              <Pressable onPress={() => setRecipientUserId(null)} style={[styles.chip, recipientUserId === null && styles.chipActive]}>
                <Text style={[styles.chipText, recipientUserId === null && styles.chipTextActive]}>None</Text>
              </Pressable>
              {members.map((m) => (
                <Pressable
                  key={m.userId}
                  onPress={() => {
                    setRecipientUserId(m.userId);
                    if (!recipient.trim()) setRecipient(m.name);
                  }}
                  style={[styles.chip, recipientUserId === m.userId && styles.chipActive]}
                >
                  <Text style={[styles.chipText, recipientUserId === m.userId && styles.chipTextActive]}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.fieldLabel}>Purpose</Text>
        <View style={styles.chips}>
          {PURPOSES.map((p) => (
            <Pressable key={p} onPress={() => setPurpose(p)} style={[styles.chip, purpose === p && styles.chipActive]}>
              <Text style={[styles.chipText, purpose === p && styles.chipTextActive]}>{PURPOSE_LABEL[p]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Method</Text>
        <View style={styles.chips}>
          {METHODS.map((m) => (
            <Pressable key={m} onPress={() => setMethod(m)} style={[styles.chip, method === m && styles.chipActive]}>
              <Text style={[styles.chipText, method === m && styles.chipTextActive]}>{METHOD_LABEL[m]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Issued date</Text>
        <View style={{ flexDirection: 'row' }}>
          <DateField label="Issued" value={issued} onChange={setIssued} max={todayIso()} />
        </View>

        <TextInput style={[styles.input, styles.multiline]} placeholder="Notes (optional)" placeholderTextColor={colors.subtle} value={notes} onChangeText={setNotes} multiline />

        {!transmittal ? (
          <>
            <Text style={styles.fieldLabel}>Drawings to transmit</Text>
            {issuable.length === 0 ? (
              <Text style={styles.hint}>No drawings available. Add drawings in the Drawings register first.</Text>
            ) : (
              <View style={styles.drawingPick}>
                {issuable.map((d) => {
                  const on = selected.has(d.revisionId);
                  return (
                    <Pressable key={d.revisionId} onPress={() => toggle(d.revisionId)} style={[styles.drawRow, on && styles.drawRowOn]}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.brand : colors.subtle} />
                      <Text style={styles.drawText} numberOfLines={1}>
                        {d.number} Rev {d.revision} — {d.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        <View style={styles.composerActions}>
          <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.submitText}>{transmittal ? 'Save' : 'Issue transmittal'}</Text>}
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
    chipSmall: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipSmallText: { fontSize: 11, fontFamily: font.bodySemi },
    // Detail
    detailTitle: { fontSize: 20, fontFamily: font.displayBold, color: c.text },
    detailRow: { gap: 2 },
    detailLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.3, color: c.subtle, textTransform: 'uppercase' },
    detailValue: { fontSize: 15, fontFamily: font.body, color: c.text },
    sectionLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 6 },
    itemList: { gap: 8 },
    itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    itemText: { flex: 1, fontSize: 14, fontFamily: font.body, color: c.text },
    actionsCol: { gap: 8, marginTop: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.surface },
    actionBtnText: { fontSize: 15, fontFamily: font.bodySemi },
    // Composer
    input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 12, fontSize: 15, fontFamily: font.body, color: c.text },
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    hint: { fontSize: 13, fontFamily: font.body, color: c.subtle },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted },
    chipTextActive: { color: c.bg },
    drawingPick: { gap: 2 },
    drawRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.sm },
    drawRowOn: { backgroundColor: c.brandSoft },
    drawText: { flex: 1, fontSize: 14, fontFamily: font.body, color: c.text },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: { flex: 1, backgroundColor: c.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
  });
