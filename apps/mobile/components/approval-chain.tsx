import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { decideApprovalStep, currentStep, type ApprovalStep } from '../lib/data/approvals';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

const ROLE_LABEL: Record<string, string> = {
  pm: 'PM',
  admin: 'Admin',
  owner: 'Owner',
  finance: 'Finance',
  member: 'Member',
  viewer: 'Viewer',
};

/** Which step roles a viewer can act on — owner covers the management slots
 *  (admin/finance) but never the PM's own step, so a later approver can't jump
 *  the earlier one. */
const COVERS: Record<string, string[]> = {
  owner: ['owner', 'admin', 'finance'],
  admin: ['admin', 'finance'],
  finance: ['finance'],
  pm: ['pm'],
  member: ['member'],
  viewer: ['viewer'],
};
function canFulfill(viewerRole: string, stepRole: string): boolean {
  return (COVERS[viewerRole] ?? [viewerRole]).includes(stepRole);
}

/** The RN twin of the web ApprovalChain. Approval is SEQUENTIAL: only the
 *  earliest pending step is actionable; a later approver sees a greyed
 *  "Pending … approval" until it's their turn. */
export function ApprovalChain({
  steps,
  viewerRole,
  onDecided,
}: {
  steps: ApprovalStep[];
  viewerRole: string;
  onDecided: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  if (steps.length === 0) return null;

  const active = currentStep(steps);
  const myStep = steps.find((s) => s.decision === 'pending' && canFulfill(viewerRole, s.approverRole));
  const canDecide = !!active && !!myStep && myStep.id === active.id;
  const waitingForEarlier = !!myStep && !!active && myStep.id !== active.id;

  function decide(decision: 'approved' | 'rejected') {
    if (!active) return;
    Alert.alert(
      decision === 'approved' ? `Approve (${ROLE_LABEL[active.approverRole] ?? active.approverRole})?` : 'Reject?',
      decision === 'approved'
        ? 'This records your step of the approval. It finalizes once every step is approved.'
        : 'This rejects the request.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approved' ? 'Approve' : 'Reject',
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            try {
              await decideApprovalStep(active.id, decision);
              onDecided();
            } catch (e) {
              Alert.alert('Could not record decision', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.chain}>
        {steps.map((s, i) => (
          <View key={s.id} style={styles.stepRow}>
            {i > 0 && <Text style={styles.arrow}>→</Text>}
            <Text
              style={[
                styles.step,
                {
                  color:
                    s.decision === 'approved'
                      ? colors.success
                      : s.decision === 'rejected'
                        ? colors.accentDeep
                        : colors.subtle,
                },
              ]}
            >
              {s.decision === 'approved' ? '✓' : s.decision === 'rejected' ? '✕' : '○'}{' '}
              {ROLE_LABEL[s.approverRole] ?? s.approverRole}
              {s.approverName ? ` · ${s.approverName}` : ''}
            </Text>
          </View>
        ))}
      </View>
      {waitingForEarlier && active && (
        <View>
          <View style={[styles.btn, styles.btnDisabled]}>
            <Text style={styles.btnDisabledText}>Approve</Text>
          </View>
          <Text style={styles.pendingHint}>
            Pending {ROLE_LABEL[active.approverRole] ?? active.approverRole} approval
          </Text>
        </View>
      )}
      {canDecide && active && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={() => decide('approved')}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrand} size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>Approve ({ROLE_LABEL[active.approverRole] ?? active.approverRole})</Text>
            )}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => decide('rejected')}>
            <Text style={styles.btnOutlineText}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, gap: 8 },
    chain: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    arrow: { color: c.subtle, fontSize: 12 },
    step: { fontSize: 12, fontFamily: font.bodySemi },
    actions: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
    btnPrimary: { backgroundColor: c.brand },
    btnPrimaryText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 13 },
    btnOutline: { borderWidth: 1, borderColor: c.border },
    btnOutlineText: { color: c.text, fontFamily: font.bodyBold, fontSize: 13 },
    btnDisabled: { backgroundColor: c.sunk, alignSelf: 'flex-start', paddingHorizontal: 18 },
    btnDisabledText: { color: c.subtle, fontFamily: font.bodyBold, fontSize: 13 },
    pendingHint: { marginTop: 4, fontSize: 11, fontFamily: font.body, color: c.subtle },
  });
