import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Card } from './ui';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import { submitBid, type TaskDoc } from '../lib/data/tenders';
import { DocAttach } from './doc-attach';

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A tender invitee's sealed bid on mobile: ONE price for the whole task plus a
 *  note describing the works. The PM compares bids and awards a winner; the
 *  winning bid's price + note lock onto the task. Editable until the PM decides.
 *  `docs` are the viewer's own bid attachments (RLS-scoped by the parent load). */
export function BidEditor({
  taskId,
  orgId,
  projectId,
  docs,
  submitted,
  bidPriceCents,
  worksNotes,
  onChanged,
}: {
  taskId: string;
  orgId: string;
  projectId: string;
  docs: TaskDoc[];
  submitted: boolean;
  bidPriceCents: number | null;
  worksNotes: string | null;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState(bidPriceCents != null ? dollars(bidPriceCents) : '');
  const [notes, setNotes] = useState(worksNotes ?? '');

  const priceCents = Math.round((Number(price) || 0) * 100);
  const canSubmit = priceCents > 0 && notes.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await submitBid(taskId, priceCents, notes.trim());
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
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
        Give one price for the whole task and describe the works you’ll do. This is your sealed bid — the PM compares it
        against others and awards a winner. You can update it until they decide.
      </Text>

      <Text style={styles.label}>Bid price ($)</Text>
      <TextInput
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={colors.subtle}
        style={[styles.input, styles.priceInput]}
      />

      <Text style={styles.label}>Works to be done</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Describe what you'll do to complete this task…"
        placeholderTextColor={colors.subtle}
        multiline
        style={[styles.input, styles.notesInput]}
      />

      <Pressable
        style={[styles.btn, styles.btnPrimary, !canSubmit && { opacity: 0.5 }]}
        disabled={!canSubmit}
        onPress={submit}
      >
        {busy ? (
          <ActivityIndicator color={colors.onBrand} />
        ) : (
          <Text style={styles.btnPrimaryText}>{submitted ? 'Update bid' : 'Submit bid'}</Text>
        )}
      </Pressable>

      <DocAttach taskId={taskId} orgId={orgId} projectId={projectId} docs={docs} bid canEdit onChanged={onChanged} />
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
    label: {
      fontSize: 11,
      fontFamily: font.bodyBold,
      color: c.subtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 16,
      marginBottom: 6,
    },
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
    priceInput: { maxWidth: 220, textAlign: 'right' },
    notesInput: { minHeight: 100, textAlignVertical: 'top' },
    btn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
    btnPrimary: { backgroundColor: c.brand },
    btnPrimaryText: { color: c.onBrand, fontFamily: font.bodyBold },
  });
