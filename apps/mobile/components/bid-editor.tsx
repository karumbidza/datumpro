import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatUsd } from '@datumpro/shared/domain';
import { Card } from './ui';
import { DateField } from './date-field';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import { updateSubtask, removeSubtask, type Subtask } from '../lib/data/subtasks';
import { addBidStep, submitBid } from '../lib/data/tenders';

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A tender invitee's sealed bid on mobile: build a priced plan, submit it.
 *  `subtasks` are the viewer's own bid lines (RLS-scoped by the parent load). */
export function BidEditor({
  taskId,
  orgId,
  subtasks,
  submitted,
  taskStart,
  taskEnd,
  onChanged,
}: {
  taskId: string;
  orgId: string;
  subtasks: Subtask[];
  submitted: boolean;
  taskStart: string | null;
  taskEnd: string | null;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState<'hours' | 'days'>('days');
  const [newStart, setNewStart] = useState<string | null>(null);
  const [newCost, setNewCost] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eQty, setEQty] = useState('');
  const [eUnit, setEUnit] = useState<'hours' | 'days'>('days');
  const [eStart, setEStart] = useState<string | null>(null);
  const [eCost, setECost] = useState('');

  const total = subtasks.reduce((s, l) => s + l.costCents, 0);
  const incomplete = (s: Subtask) => !s.estQty || !s.estUnit || !s.plannedStartDate || s.costCents <= 0;
  const anyIncomplete = subtasks.some(incomplete);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(s: Subtask) {
    setEditingId(s.id);
    setETitle(s.title);
    setEQty(s.estQty != null ? String(s.estQty) : '');
    setEUnit(s.estUnit ?? 'days');
    setEStart(s.plannedStartDate);
    setECost(s.costCents ? dollars(s.costCents) : '');
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Your bid</Text>
        {submitted && (
          <View style={styles.submittedBadge}>
            <Text style={styles.submittedText}>Submitted</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>
        Break the work into the steps you’d do — each with a duration, start date and cost. This is your sealed bid; the
        PM compares it against others. You can edit until they decide.
      </Text>

      <View style={{ gap: 8, marginTop: 10 }}>
        {subtasks.map((s) =>
          editingId === s.id ? (
            <View key={s.id} style={styles.editRow}>
              <TextInput value={eTitle} onChangeText={setETitle} placeholder="What's the step?" placeholderTextColor={colors.subtle} style={styles.input} />
              <View style={styles.grid}>
                <TextInput value={eQty} onChangeText={setEQty} keyboardType="numeric" placeholder="Duration" placeholderTextColor={colors.subtle} style={[styles.input, styles.qty]} />
                <View style={styles.unitToggle}>
                  {(['hours', 'days'] as const).map((u) => (
                    <Pressable key={u} style={[styles.unitBtn, eUnit === u && styles.unitBtnOn]} onPress={() => setEUnit(u)}>
                      <Text style={[styles.unitText, eUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput value={eCost} onChangeText={setECost} keyboardType="numeric" placeholder="Cost $" placeholderTextColor={colors.subtle} style={[styles.input, styles.cost]} />
              </View>
              <DateField label="Start" value={eStart} onChange={setEStart} min={taskStart} max={taskEnd} />
              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, (!eTitle.trim() || busy) && { opacity: 0.5 }]}
                  disabled={!eTitle.trim() || busy}
                  onPress={() =>
                    run(async () => {
                      await updateSubtask(s.id, {
                        title: eTitle.trim(),
                        estQty: Number(eQty) || null,
                        estUnit: eUnit,
                        plannedStartDate: eStart,
                        costCents: Math.round((Number(eCost) || 0) * 100),
                      });
                      setEditingId(null);
                    })
                  }
                >
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Done</Text>}
                </Pressable>
                <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => setEditingId(null)}>
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={s.id} style={styles.stepCard}>
              <Pressable style={{ flex: 1 }} onPress={() => openEdit(s)}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={[styles.stepMeta, incomplete(s) && styles.stepWarn]}>
                  {incomplete(s)
                    ? '⚠ Tap to add duration, start date & cost'
                    : `${s.estQty} ${s.estUnit} · ${s.plannedStartDate} · ${formatUsd(s.costCents)}`}
                </Text>
              </Pressable>
              <Pressable onPress={() => openEdit(s)} hitSlop={8}>
                <Ionicons name="create-outline" size={18} color={colors.subtle} />
              </Pressable>
              <Pressable disabled={busy} onPress={() => run(() => removeSubtask(s.id))} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.subtle} />
              </Pressable>
            </View>
          ),
        )}
      </View>

      {/* add a step */}
      {!addOpen ? (
        <Pressable style={styles.addStepBtn} onPress={() => setAddOpen(true)}>
          <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
          <Text style={styles.addStepText}>Add a step</Text>
        </Pressable>
      ) : (
        <View style={styles.addBlock}>
          <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="What's the step?" placeholderTextColor={colors.subtle} style={styles.input} />
          <View style={styles.grid}>
            <TextInput value={newQty} onChangeText={setNewQty} keyboardType="numeric" placeholder="Duration" placeholderTextColor={colors.subtle} style={[styles.input, styles.qty]} />
            <View style={styles.unitToggle}>
              {(['hours', 'days'] as const).map((u) => (
                <Pressable key={u} style={[styles.unitBtn, newUnit === u && styles.unitBtnOn]} onPress={() => setNewUnit(u)}>
                  <Text style={[styles.unitText, newUnit === u && styles.unitTextOn]}>{u === 'hours' ? 'hrs' : 'days'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={newCost} onChangeText={setNewCost} keyboardType="numeric" placeholder="Cost $" placeholderTextColor={colors.subtle} style={[styles.input, styles.cost]} />
          </View>
          <DateField label="Start" value={newStart} onChange={setNewStart} min={taskStart} max={taskEnd} />
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, styles.btnPrimary, (!newTitle.trim() || busy) && { opacity: 0.5 }]}
              disabled={!newTitle.trim() || busy}
              onPress={() =>
                run(async () => {
                  await addBidStep({
                    taskId,
                    orgId,
                    title: newTitle.trim(),
                    costCents: Math.round((Number(newCost) || 0) * 100),
                    estQty: Number(newQty) || null,
                    estUnit: newUnit,
                    plannedStartDate: newStart,
                  });
                  setNewTitle('');
                  setNewQty('');
                  setNewCost('');
                  setNewStart(null);
                  setAddOpen(false);
                })
              }
            >
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Add step</Text>}
            </Pressable>
            <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => setAddOpen(false)}>
              <Text style={styles.btnOutlineText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* total + submit */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>
          Your total: <Text style={styles.totalValue}>{formatUsd(total)}</Text>
        </Text>
      </View>
      {subtasks.length > 0 && anyIncomplete && (
        <Text style={styles.gateHint}>Every step needs a duration, a start date and a cost before you can submit.</Text>
      )}
      <Pressable
        style={[styles.btn, styles.btnPrimary, (subtasks.length === 0 || anyIncomplete || busy) && { opacity: 0.5 }]}
        disabled={subtasks.length === 0 || anyIncomplete || busy}
        onPress={() => run(() => submitBid(taskId))}
      >
        {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>{submitted ? 'Update bid' : 'Submit bid'}</Text>}
      </Pressable>
    </Card>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 15, fontFamily: font.bodyHeavy, color: c.text },
    submittedBadge: { backgroundColor: c.brandSoft, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
    submittedText: { fontSize: 11, fontFamily: font.bodyBold, color: c.brandDeep },
    hint: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 4 },
    editRow: { gap: 8, borderWidth: 1, borderColor: c.brand, borderRadius: radius.md, padding: 10 },
    stepCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    stepTitle: { fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    stepMeta: { fontSize: 11, fontFamily: font.body, color: c.subtle, marginTop: 2 },
    stepWarn: { color: c.accent, fontFamily: font.bodySemi },
    grid: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    qty: { width: 64, textAlign: 'center' },
    cost: { flex: 1, textAlign: 'right' },
    unitToggle: { flexDirection: 'row', borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden' },
    unitBtn: { paddingHorizontal: 10, paddingVertical: 9 },
    unitBtnOn: { backgroundColor: c.brand },
    unitText: { fontSize: 12, fontFamily: font.bodySemi, color: c.muted },
    unitTextOn: { color: c.onBrand },
    input: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: font.body,
      color: c.text,
    },
    addBlock: { gap: 8, marginTop: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10 },
    addStepBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 8,
      borderWidth: 1,
      borderColor: c.brand,
      borderStyle: 'dashed',
      borderRadius: radius.md,
      paddingVertical: 12,
    },
    addStepText: { color: c.brand, fontFamily: font.bodyBold, fontSize: 14 },
    row: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    btnPrimary: { backgroundColor: c.brand },
    btnPrimaryText: { color: c.onBrand, fontFamily: font.bodyBold },
    btnOutline: { borderWidth: 1, borderColor: c.border },
    btnOutlineText: { color: c.text, fontFamily: font.bodySemi },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, marginTop: 10 },
    totalLabel: { fontSize: 13, fontFamily: font.body, color: c.muted },
    totalValue: { fontFamily: font.bodyBold, color: c.text },
    gateHint: { fontSize: 11, fontFamily: font.body, color: c.accent, marginTop: 8 },
  });
