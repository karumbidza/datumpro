import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatUsd } from '@datumpro/shared/domain';
import {
  listMyPayments,
  submitPaymentClaim,
  type MyDraw,
  type MyPaymentsSummary,
} from '../../../lib/data/payments';
import { Card, Pill, StatTile } from '../../../components/ui';
import { theme, contentWidth, type Tone } from '../../../lib/theme';

const EMPTY: MyPaymentsSummary = { earnedCents: 0, claimedCents: 0, paidCents: 0, outstandingCents: 0 };

const STATUS: Record<MyDraw['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Not claimed', tone: { bg: '#e5e7eb', fg: '#374151', bar: '#6b7280' } },
  invoiced: {
    label: 'Awaiting payment',
    tone: { bg: theme.color.accentSoft, fg: theme.color.accent, bar: theme.color.accent },
  },
  paid: {
    label: 'Paid',
    tone: { bg: theme.color.successSoft, fg: theme.color.success, bar: theme.color.success },
  },
};

export default function Payments() {
  const router = useRouter();
  const [lines, setLines] = useState<MyDraw[]>([]);
  const [summary, setSummary] = useState<MyPaymentsSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listMyPayments();
    setLines(res.lines);
    setSummary(res.summary);
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Payments</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={lines}
          keyExtractor={(l) => l.id}
          contentContainerStyle={lines.length === 0 ? styles.emptyWrap : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListHeaderComponent={
            <Card style={styles.summary}>
              <View style={styles.statsRow}>
                <StatTile label="Earned" value={formatUsd(summary.earnedCents)} />
                <StatTile
                  label="Awaiting"
                  value={formatUsd(summary.claimedCents)}
                  accent={theme.color.accent}
                />
              </View>
              <View style={styles.statsRow}>
                <StatTile
                  label="Paid"
                  value={formatUsd(summary.paidCents)}
                  accent={theme.color.success}
                />
                <StatTile label="Outstanding" value={formatUsd(summary.outstandingCents)} />
              </View>
            </Card>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No draws yet. When you&apos;re awarded a task, your payment schedule appears here.
            </Text>
          }
          renderItem={({ item }) => {
            const s = STATUS[item.status];
            return (
              <Card style={styles.draw}>
                <View style={styles.drawTop}>
                  <Text style={styles.project}>{item.projectName}</Text>
                  <Pill label={s.label} tone={s.tone} />
                </View>
                <Pressable onPress={() => item.taskId && router.push(`/(app)/task/${item.taskId}`)}>
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
                    style={[styles.claimBtn, claiming === item.id && styles.claimBtnBusy]}
                  >
                    <Text style={styles.claimText}>
                      {claiming === item.id ? 'Submitting…' : 'Claim payment'}
                    </Text>
                  </Pressable>
                ) : null}
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  title: { fontSize: 24, fontWeight: '800', color: theme.color.text, paddingHorizontal: 20, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10, ...contentWidth },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { color: theme.color.subtle, fontSize: 14, textAlign: 'center' },
  summary: { gap: 12, marginBottom: 4 },
  statsRow: { flexDirection: 'row', gap: 12 },
  draw: { gap: 6 },
  drawTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  project: { fontSize: 12, fontWeight: '600', color: theme.color.subtle },
  task: { fontSize: 15, fontWeight: '700', color: theme.color.text },
  drawBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drawName: { fontSize: 13, color: theme.color.muted },
  amount: { fontSize: 15, fontWeight: '800', color: theme.color.text },
  note: { fontSize: 12, color: theme.color.muted, fontStyle: 'italic' },
  paidRef: { fontSize: 12, color: theme.color.success },
  claimBtn: {
    marginTop: 6,
    backgroundColor: theme.color.dark,
    borderRadius: theme.radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  claimBtnBusy: { opacity: 0.6 },
  claimText: { color: theme.color.onDark, fontWeight: '700', fontSize: 14 },
});
