import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';
import {
  listMyPayments,
  submitPaymentClaim,
  type MyDraw,
  type MyPaymentsSummary,
} from '../../../lib/data/payments';
import {
  listMyPaymentRequests,
  listMyRequestProjects,
  type MyPaymentRequest,
  type RequestProject,
} from '../../../lib/data/payment-requests';
import { RequestPaymentModal } from '../../../components/request-payment-modal';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { useResponsive } from '../../../lib/responsive';

const EMPTY: MyPaymentsSummary = { earnedCents: 0, claimedCents: 0, paidCents: 0, outstandingCents: 0 };

type PillPair = { bg: string; fg: string };

/** Status pill colour PAIRS — soft bg + deep fg — so they stay legible in dark
 *  mode. Shared by payment requests and scheduled draws. */
function reqPill(c: Colors, status: PaymentRequestStatus): PillPair {
  switch (status) {
    case 'requested':
      return { bg: c.accentSoft, fg: c.accentDeep };
    case 'approved':
      return { bg: c.brandSoft, fg: c.brandDeep };
    case 'paid':
      return { bg: c.successSoft, fg: c.success };
    case 'rejected':
      return { bg: c.sunk, fg: c.muted };
    default:
      return { bg: c.sunk, fg: c.muted };
  }
}

const DRAW_STATUS: Record<MyDraw['status'], { label: string; status: PaymentRequestStatus }> = {
  pending: { label: 'Not claimed', status: 'rejected' },
  invoiced: { label: 'Awaiting payment', status: 'requested' },
  paid: { label: 'Paid', status: 'paid' },
};

export default function Payments() {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const [lines, setLines] = useState<MyDraw[]>([]);
  const [summary, setSummary] = useState<MyPaymentsSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [requests, setRequests] = useState<MyPaymentRequest[]>([]);
  const [projects, setProjects] = useState<RequestProject[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    const [res, reqs, projs] = await Promise.all([
      listMyPayments(),
      listMyPaymentRequests(),
      listMyRequestProjects(),
    ]);
    setLines(res.lines);
    setSummary(res.summary);
    setRequests(reqs);
    setProjects(projs);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const claim = useCallback(
    (draw: MyDraw) => {
      Alert.alert(
        'Claim payment',
        `Submit a claim for “${draw.name}” (${formatUsd(draw.amountCents)})? Your project manager will review and pay it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Submit claim',
            onPress: async () => {
              setClaiming(draw.id);
              try {
                await submitPaymentClaim(draw.id, '');
                await load();
              } catch (e) {
                Alert.alert('Could not claim', e instanceof Error ? e.message : 'Please try again.');
              } finally {
                setClaiming(null);
              }
            },
          },
        ],
      );
    },
    [load],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Payments</Text>

      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <FlatList
          data={lines}
          keyExtractor={(l) => l.id}
          contentContainerStyle={
            lines.length === 0 ? styles.emptyWrap : [styles.listContent, { maxWidth: contentMaxWidth }]
          }
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
              {/* 2×2 summary grid */}
              <View style={styles.grid}>
                <View style={styles.gridRow}>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Earned</Text>
                    <Text style={styles.tileValue}>{formatUsd(summary.earnedCents)}</Text>
                  </View>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Awaiting</Text>
                    <Text style={[styles.tileValue, { color: colors.brand }]}>
                      {formatUsd(summary.claimedCents)}
                    </Text>
                  </View>
                </View>
                <View style={styles.gridRow}>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Paid</Text>
                    <Text style={[styles.tileValue, { color: colors.success }]}>
                      {formatUsd(summary.paidCents)}
                    </Text>
                  </View>
                  <View style={[styles.tile, scheme === 'light' && styles.shadow]}>
                    <Text style={styles.tileLabel}>Outstanding</Text>
                    <Text style={styles.tileValue}>{formatUsd(summary.outstandingCents)}</Text>
                  </View>
                </View>
              </View>

              {/* Payment requests */}
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Payment requests</Text>
                {projects.length > 0 && (
                  <Pressable
                    onPress={() => setModalOpen(true)}
                    style={({ pressed }) => [styles.reqBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.reqBtnText}>Request payment</Text>
                  </Pressable>
                )}
              </View>

              {requests.length === 0 ? (
                <Text style={styles.hint}>
                  No requests yet. Raise one to invoice for a draw or ad-hoc work.
                </Text>
              ) : (
                requests.map((r) => {
                  const pill = reqPill(colors, r.status);
                  return (
                    <View key={r.id} style={[styles.card, scheme === 'light' && styles.shadow]}>
                      <View style={styles.drawTop}>
                        <Text style={styles.project} numberOfLines={1}>
                          {r.projectName}
                        </Text>
                        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                          <Text style={[styles.pillText, { color: pill.fg }]}>
                            {PAYMENT_REQUEST_STATUS_LABEL[r.status]}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.drawBottom}>
                        <Text style={styles.task} numberOfLines={1}>
                          {r.title}
                        </Text>
                        <Text style={styles.amount}>{formatUsd(r.amountCents)}</Text>
                      </View>
                      {r.status === 'rejected' && r.reviewNote ? (
                        <Text style={styles.note}>“{r.reviewNote}”</Text>
                      ) : null}
                      <View style={styles.linkRow}>
                        {r.invoiceUrl ? (
                          <Pressable onPress={() => Linking.openURL(r.invoiceUrl!)}>
                            <Text style={styles.link}>View invoice</Text>
                          </Pressable>
                        ) : null}
                        {r.status === 'paid' && r.popUrl ? (
                          <Pressable onPress={() => Linking.openURL(r.popUrl!)}>
                            <Text style={styles.link}>Proof of payment</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}

              {lines.length > 0 && (
                <Text style={[styles.sectionTitle, styles.drawsHead]}>Scheduled draws</Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No draws yet. When you&apos;re awarded a task, your payment schedule appears here.
            </Text>
          }
          renderItem={({ item }) => {
            const meta = DRAW_STATUS[item.status];
            const pill = reqPill(colors, meta.status);
            return (
              <View style={[styles.card, scheme === 'light' && styles.shadow]}>
                <View style={styles.drawTop}>
                  <Text style={styles.project} numberOfLines={1}>
                    {item.projectName}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                    <Text style={[styles.pillText, { color: pill.fg }]}>{meta.label}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => item.taskId && router.push(`/(app)/task/${item.taskId}`)}
                  style={({ pressed }) => pressed && item.taskId ? styles.pressed : undefined}
                >
                  <Text style={styles.task}>{item.taskTitle ?? item.name}</Text>
                </Pressable>
                <View style={styles.drawBottom}>
                  <Text style={styles.drawName}>{item.name}</Text>
                  <Text style={styles.amount}>{formatUsd(item.amountCents)}</Text>
                </View>

                {item.status === 'invoiced' && item.claimNote ? (
                  <Text style={styles.note}>“{item.claimNote}”</Text>
                ) : null}
                {item.status === 'paid' && item.paidReference ? (
                  <Text style={styles.paidRef}>Ref {item.paidReference}</Text>
                ) : null}

                {item.status === 'pending' ? (
                  <Pressable
                    onPress={() => claim(item)}
                    disabled={claiming === item.id}
                    style={({ pressed }) => [
                      styles.claimBtn,
                      claiming === item.id && styles.claimBtnBusy,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.claimText}>
                      {claiming === item.id ? 'Submitting…' : 'Claim payment'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}

      <RequestPaymentModal
        visible={modalOpen}
        projects={projects}
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
    title: {
      fontSize: 26,
      fontFamily: font.displayBold,
      color: c.text,
      paddingHorizontal: 20,
      paddingTop: 8,
      letterSpacing: -0.3,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, gap: 10, ...contentWidth },
    emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center' },
    pressed: { opacity: 0.85 },
    shadow: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    grid: { gap: 12 },
    gridRow: { flexDirection: 'row', gap: 12 },
    tile: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 4,
    },
    tileLabel: { fontSize: 12, fontFamily: font.body, color: c.muted },
    tileValue: { fontSize: 22, fontFamily: font.displayBold, color: c.text, fontVariant: ['tabular-nums'] },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 17, fontFamily: font.displayBold, color: c.text },
    drawsHead: { marginTop: 4 },
    reqBtn: { backgroundColor: c.text, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
    reqBtnText: { color: c.bg, fontFamily: font.bodyBold, fontSize: 13 },
    hint: { fontSize: 13, fontFamily: font.body, color: c.subtle },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 8,
    },
    pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    pillText: { fontSize: 11, fontFamily: font.bodyBold },
    linkRow: { flexDirection: 'row', gap: 16, marginTop: 2 },
    link: { fontSize: 13, fontFamily: font.bodySemi, color: c.brand },
    drawTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    project: { fontSize: 12, fontFamily: font.bodySemi, color: c.subtle, flex: 1 },
    task: { fontSize: 15, fontFamily: font.bodyBold, color: c.text },
    drawBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    drawName: { fontSize: 13, fontFamily: font.body, color: c.muted },
    amount: { fontSize: 15, fontFamily: font.display, color: c.text, fontVariant: ['tabular-nums'] },
    note: { fontSize: 12, fontFamily: font.body, color: c.muted, fontStyle: 'italic' },
    paidRef: { fontSize: 12, fontFamily: font.body, color: c.success },
    claimBtn: {
      marginTop: 6,
      backgroundColor: c.text,
      borderRadius: radius.pill,
      paddingVertical: 10,
      alignItems: 'center',
    },
    claimBtnBusy: { opacity: 0.6 },
    claimText: { color: c.bg, fontFamily: font.bodyBold, fontSize: 14 },
  });
