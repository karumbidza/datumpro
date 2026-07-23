import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';
import { listMyOwed, type OwedTask, type OwedSummary } from '../../../lib/data/owed';
import {
  listMyPaymentRequests,
  type MyPaymentRequest,
} from '../../../lib/data/payment-requests';
import { RequestPaymentModal } from '../../../components/request-payment-modal';
import { ApprovalChain } from '../../../components/approval-chain';
import { stepsByEntity, type ApprovalStep } from '../../../lib/data/approvals';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { useResponsive } from '../../../lib/responsive';
import { currentUser } from '../../../lib/supabase';
import { useLiveRefresh, type LiveSub } from '../../../lib/use-live-refresh';

const EMPTY: OwedSummary = { earnedCents: 0, awaitingCents: 0, paidCents: 0, outstandingCents: 0 };

function reqPill(c: Colors, status: PaymentRequestStatus): { bg: string; fg: string } {
  switch (status) {
    case 'requested':
      return { bg: c.accentSoft, fg: c.accentDeep };
    case 'approved':
      return { bg: c.brandSoft, fg: c.brandDeep };
    case 'paid':
      return { bg: c.successSoft, fg: c.success };
    default:
      return { bg: c.sunk, fg: c.muted };
  }
}

export default function Payments() {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const [owed, setOwed] = useState<OwedTask[]>([]);
  const [summary, setSummary] = useState<OwedSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<MyPaymentRequest[]>([]);
  const [reqSteps, setReqSteps] = useState<Map<string, ApprovalStep[]>>(new Map());
  const [modalOpen, setModalOpen] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [owedRes, reqs] = await Promise.all([listMyOwed(), listMyPaymentRequests()]);
    setOwed(owedRes.tasks);
    setSummary(owedRes.summary);
    setRequests(reqs);
    setReqSteps(await stepsByEntity('payment', reqs.map((r) => r.id)));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    let active = true;
    void currentUser().then((u) => {
      if (active) setMeId(u?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const liveSubs = useMemo<LiveSub[]>(
    () => (meId ? [{ table: 'contractor_payment_requests', filter: `contractor_id=eq.${meId}` }] : []),
    [meId],
  );
  useLiveRefresh(liveSubs, () => void load());

  const canRequest = owed.some((t) => t.requestableCents > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Payments</Text>

      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <FlatList
          data={owed}
          keyExtractor={(t) => t.taskId}
          contentContainerStyle={[styles.listContent, { maxWidth: contentMaxWidth }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.brand}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 14 }}>
              <View style={styles.grid}>
                <View style={styles.gridRow}>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Earned</Text>
                    <Text style={styles.tileValue}>{formatUsd(summary.earnedCents)}</Text>
                  </View>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Awaiting</Text>
                    <Text style={[styles.tileValue, { color: colors.brand }]}>{formatUsd(summary.awaitingCents)}</Text>
                  </View>
                </View>
                <View style={styles.gridRow}>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Paid</Text>
                    <Text style={[styles.tileValue, { color: colors.success }]}>{formatUsd(summary.paidCents)}</Text>
                  </View>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Outstanding</Text>
                    <Text style={styles.tileValue}>{formatUsd(summary.outstandingCents)}</Text>
                  </View>
                </View>
              </View>

              {/* Payment request history */}
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Payment requests</Text>
                {canRequest && (
                  <Pressable onPress={() => setModalOpen(true)} style={({ pressed }) => [styles.reqBtn, pressed && styles.pressed]}>
                    <Text style={styles.reqBtnText}>Request payment</Text>
                  </Pressable>
                )}
              </View>

              {requests.length === 0 ? (
                <Text style={styles.hint}>No requests yet. Invoice against an approved task above.</Text>
              ) : (
                requests.map((r) => {
                  const pill = reqPill(colors, r.status);
                  return (
                    <View key={r.id} style={[styles.card, scheme === 'light' && styles.shadow]}>
                      <View style={styles.rowTop}>
                        <Text style={styles.project} numberOfLines={1}>{r.projectName}</Text>
                        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                          <Text style={[styles.pillText, { color: pill.fg }]}>{PAYMENT_REQUEST_STATUS_LABEL[r.status]}</Text>
                        </View>
                      </View>
                      <View style={styles.rowBottom}>
                        <Text style={styles.task} numberOfLines={1}>{r.title}</Text>
                        <Text style={styles.amount}>{formatUsd(r.amountCents)}</Text>
                      </View>
                      {r.status === 'rejected' && r.reviewNote ? <Text style={styles.note}>“{r.reviewNote}”</Text> : null}
                      {r.status === 'requested' && <ApprovalChain steps={reqSteps.get(r.id) ?? []} viewerRole="" onDecided={load} />}
                      <View style={styles.linkRow}>
                        {r.invoiceUrl ? (
                          <Pressable onPress={() => Linking.openURL(r.invoiceUrl!)}><Text style={styles.link}>View invoice</Text></Pressable>
                        ) : null}
                        {r.status === 'paid' && r.popUrl ? (
                          <Pressable onPress={() => Linking.openURL(r.popUrl!)}><Text style={styles.link}>Proof of payment</Text></Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}

              <Text style={[styles.sectionTitle, styles.owedHead]}>What you&apos;re owed</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              Nothing yet. When a plan you priced is approved and the work is yours, the agreed amount shows here.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/(app)/task/${item.taskId}`)}
              style={({ pressed }) => [styles.card, scheme === 'light' && styles.shadow, pressed && styles.pressed]}
            >
              <View style={styles.rowTop}>
                <Text style={styles.project} numberOfLines={1}>{item.projectName}</Text>
                <Text style={styles.outLabel}>outstanding</Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.task} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.amount}>{formatUsd(item.outstandingCents)}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.metaText}>Committed {formatUsd(item.committedCents)}</Text>
                <Text style={[styles.metaText, { color: colors.success }]}>Paid {formatUsd(item.paidCents)}</Text>
                {item.pendingCents > 0 && (
                  <Text style={[styles.metaText, { color: colors.brand }]}>In review {formatUsd(item.pendingCents)}</Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      <RequestPaymentModal
        visible={modalOpen}
        tasks={owed}
        onClose={() => setModalOpen(false)}
        onDone={() => {
          setModalOpen(false);
          void load();
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    title: { fontSize: 26, fontFamily: font.displayBold, color: c.text, paddingHorizontal: 20, paddingTop: 8, letterSpacing: -0.3 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, gap: 10, ...contentWidth },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center', paddingVertical: 16 },
    pressed: { opacity: 0.85 },
    shadow: { shadowColor: '#101828', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
    grid: { gap: 12 },
    gridRow: { flexDirection: 'row', gap: 12 },
    tile: { flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4 },
    tileLabel: { fontSize: 12, fontFamily: font.body, color: c.muted },
    tileValue: { fontSize: 22, fontFamily: font.displayBold, color: c.text, fontVariant: ['tabular-nums'] },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 17, fontFamily: font.displayBold, color: c.text },
    owedHead: { marginTop: 4 },
    reqBtn: { backgroundColor: c.text, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
    reqBtnText: { color: c.bg, fontFamily: font.bodyBold, fontSize: 13 },
    hint: { fontSize: 13, fontFamily: font.body, color: c.subtle },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 16, gap: 8 },
    pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    pillText: { fontSize: 11, fontFamily: font.bodyBold },
    linkRow: { flexDirection: 'row', gap: 16, marginTop: 2 },
    link: { fontSize: 13, fontFamily: font.bodySemi, color: c.brand },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    project: { fontSize: 12, fontFamily: font.bodySemi, color: c.subtle, flex: 1 },
    outLabel: { fontSize: 11, fontFamily: font.body, color: c.subtle },
    task: { fontSize: 15, fontFamily: font.bodyBold, color: c.text, flex: 1 },
    rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    amount: { fontSize: 15, fontFamily: font.display, color: c.text, fontVariant: ['tabular-nums'] },
    note: { fontSize: 12, fontFamily: font.body, color: c.muted, fontStyle: 'italic' },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metaText: { fontSize: 11.5, fontFamily: font.body, color: c.muted },
  });
