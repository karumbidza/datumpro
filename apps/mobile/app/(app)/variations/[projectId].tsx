import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatUsd } from '@datumpro/shared/domain';
import { listVariations, type Variation } from '../../../lib/data/variations';
import {
  listProjectVariationOrders,
  decideVariationOrder,
  canManageProject,
  type VariationOrder,
  type VariationOrderStatus,
} from '../../../lib/data/variation-orders';
import { Card, Pill } from '../../../components/ui';
import { contentWidth, radius, font, type Colors, type Tone } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function subtaskStatusFor(c: Colors): Record<Variation['status'], { label: string; tone: Tone }> {
  return {
    pending: { label: 'pending', tone: { bg: c.accentSoft, fg: c.accentDeep, bar: c.accent } },
    approved: { label: 'approved', tone: { bg: c.successSoft, fg: c.success, bar: c.success } },
    rejected: { label: 'rejected', tone: { bg: c.dangerSoft, fg: c.danger, bar: c.danger } },
  };
}
function orderTone(s: VariationOrderStatus, c: Colors): Tone {
  if (s === 'approved') return { bg: c.successSoft, fg: c.success, bar: c.success };
  if (s === 'rejected') return { bg: c.dangerSoft, fg: c.danger, bar: c.danger };
  if (s === 'submitted') return { bg: c.accentSoft, fg: c.accentDeep, bar: c.accent };
  return { bg: c.sunk, fg: c.subtle, bar: c.muted }; // draft
}
const ORDER_LABEL: Record<VariationOrderStatus, string> = {
  draft: 'draft',
  submitted: 'awaiting decision',
  approved: 'approved',
  rejected: 'rejected',
};

export default function Variations() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const SUBTASK_STATUS = useMemo(() => subtaskStatusFor(colors), [colors]);
  const [orders, setOrders] = useState<VariationOrder[]>([]);
  const [rows, setRows] = useState<Variation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ord, list, manage] = await Promise.all([
      listProjectVariationOrders(String(projectId)),
      listVariations(String(projectId)),
      canManageProject(String(projectId)),
    ]);
    setOrders(ord);
    setRows(list);
    setCanManage(manage);
    setLoading(false);
    setRefreshing(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function decide(vo: VariationOrder, decision: 'approved' | 'rejected') {
    Alert.alert(
      decision === 'approved' ? 'Approve change order' : 'Reject change order',
      `VO #${vo.number} — ${vo.description}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approved' ? 'Approve' : 'Reject',
          style: decision === 'approved' ? 'default' : 'destructive',
          onPress: async () => {
            setBusyId(vo.id);
            try {
              await decideVariationOrder(vo.id, String(projectId), decision);
              await load();
            } catch (e) {
              Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name ? `${name} · Variations` : 'Variations',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        >
          {/* Change orders (variation_orders) — the ones raised for a decision. */}
          {orders.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Change orders</Text>
              {orders.map((vo) => {
                const tone = orderTone(vo.status, colors);
                const timeBit = vo.timeImpactDays ? ` · ${vo.timeImpactDays > 0 ? '+' : ''}${vo.timeImpactDays}d` : '';
                return (
                  <Card key={vo.id} style={{ gap: 6, marginBottom: 10 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.desc}>
                        VO #{vo.number} · {vo.description}
                      </Text>
                      <Pill label={ORDER_LABEL[vo.status]} tone={tone} />
                    </View>
                    <Text style={styles.meta}>
                      {formatUsd(vo.costImpactCents)}
                      {timeBit}
                      {vo.createdByName ? ` · raised by ${vo.createdByName}` : ''}
                    </Text>
                    {vo.status === 'submitted' && canManage ? (
                      <View style={styles.actions}>
                        <Pressable
                          style={[styles.decideBtn, styles.approveBtn, busyId === vo.id && styles.disabled]}
                          onPress={() => decide(vo, 'approved')}
                          disabled={busyId === vo.id}
                        >
                          {busyId === vo.id ? (
                            <ActivityIndicator color={colors.onBrand} size="small" />
                          ) : (
                            <>
                              <Ionicons name="checkmark" size={16} color={colors.onBrand} />
                              <Text style={styles.approveText}>Approve</Text>
                            </>
                          )}
                        </Pressable>
                        <Pressable
                          style={[styles.decideBtn, styles.rejectBtn, busyId === vo.id && styles.disabled]}
                          onPress={() => decide(vo, 'rejected')}
                          disabled={busyId === vo.id}
                        >
                          <Ionicons name="close" size={16} color={colors.danger} />
                          <Text style={styles.rejectText}>Reject</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </>
          )}

          {/* Item variations (subtask-level) — read-only. */}
          <Text style={styles.sectionLabel}>Item variations</Text>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No item variations on this project yet.</Text>
          ) : (
            rows.map((item) => {
              const s = SUBTASK_STATUS[item.status];
              return (
                <Card key={item.id} style={{ gap: 6, marginBottom: 10 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.desc}>{item.title}</Text>
                    <Pill label={s.label} tone={s.tone} />
                  </View>
                  <Text style={styles.meta}>
                    {item.taskTitle} · {formatUsd(item.costCents)}
                  </Text>
                </Card>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 16, ...contentWidth },
    sectionLabel: { fontSize: 12, fontFamily: font.bodyBold, letterSpacing: 0.4, color: c.subtle, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center', marginTop: 8, marginBottom: 12 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    desc: { flex: 1, fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    meta: { fontSize: 12, fontFamily: font.body, color: c.muted },
    actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    decideBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, paddingVertical: 10 },
    approveBtn: { backgroundColor: c.success },
    rejectBtn: { borderWidth: 1, borderColor: c.danger, backgroundColor: c.surface },
    approveText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 14 },
    rejectText: { color: c.danger, fontFamily: font.bodyBold, fontSize: 14 },
    disabled: { opacity: 0.6 },
  });
