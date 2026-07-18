import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatUsd } from '@datumpro/shared/domain';
import {
  listVariations,
  raiseVariation,
  decideVariation,
  type Variation,
} from '../../../lib/data/variations';
import { canManageProjectById } from '../../../lib/data/tasks';
import { Card, Pill } from '../../../components/ui';
import { contentWidth, radius, font, type Colors, type Tone } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function statusFor(c: Colors): Record<Variation['status'], { label: string; tone: Tone }> {
  return {
    draft: { label: 'draft', tone: { bg: c.sunk, fg: c.muted, bar: c.subtle } },
    submitted: {
      label: 'awaiting decision',
      tone: { bg: c.accentSoft, fg: c.accentDeep, bar: c.accent },
    },
    approved: {
      label: 'approved',
      tone: { bg: c.successSoft, fg: c.success, bar: c.success },
    },
    rejected: { label: 'rejected', tone: { bg: c.sunk, fg: c.muted, bar: c.subtle } },
  };
}

function impact(cents: number, days: number): string {
  const parts: string[] = [];
  if (cents !== 0) parts.push(`${cents > 0 ? '+' : '−'}${formatUsd(Math.abs(cents))}`);
  if (days !== 0) parts.push(`${days > 0 ? '+' : '−'}${Math.abs(days)}d`);
  return parts.length ? parts.join(' · ') : 'no cost/time change';
}

export default function Variations() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const STATUS = useMemo(() => statusFor(colors), [colors]);
  const [rows, setRows] = useState<Variation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');
  const [days, setDays] = useState('');

  const load = useCallback(async () => {
    const [list, manage] = await Promise.all([
      listVariations(String(projectId)),
      canManageProjectById(String(projectId)),
    ]);
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

  async function submit() {
    if (!desc.trim() || busy) return;
    setBusy(true);
    try {
      await raiseVariation({
        projectId: String(projectId),
        description: desc,
        costCents: Math.round((Number(cost) || 0) * 100),
        timeDays: Number(days) || 0,
      });
      setDesc('');
      setCost('');
      setDays('');
      setShowForm(false);
      await load();
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function decide(v: Variation, approve: boolean) {
    Alert.alert(approve ? 'Approve variation?' : 'Reject variation?', v.description, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: approve ? 'Approve' : 'Reject',
        style: approve ? 'default' : 'destructive',
        onPress: async () => {
          try {
            await decideVariation(v.id, approve);
            await load();
          } catch (e) {
            Alert.alert('Failed', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name ? `${name} · Changes` : 'Change orders',
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
        <FlatList
          data={rows}
          keyExtractor={(v) => v.id}
          contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
          }
          ListHeaderComponent={
            <View style={{ marginBottom: 10 }}>
              {showForm ? (
                <Card style={{ gap: 8 }}>
                  <Text style={styles.formLabel}>Raise a variation</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Describe the change"
                    placeholderTextColor={colors.subtle}
                    value={desc}
                    onChangeText={setDesc}
                    multiline
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Cost ± $"
                      placeholderTextColor={colors.subtle}
                      value={cost}
                      onChangeText={setCost}
                      keyboardType="numbers-and-punctuation"
                    />
                    <TextInput
                      style={[styles.input, { width: 90 }]}
                      placeholder="Days ±"
                      placeholderTextColor={colors.subtle}
                      value={days}
                      onChangeText={setDays}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
                      <Text style={styles.btnPrimaryText}>{busy ? 'Submitting…' : 'Submit for review'}</Text>
                    </Pressable>
                    <Pressable style={styles.btn} onPress={() => setShowForm(false)}>
                      <Text style={styles.btnText}>Cancel</Text>
                    </Pressable>
                  </View>
                </Card>
              ) : (
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => setShowForm(true)}>
                  <Text style={styles.btnPrimaryText}>+ Raise a variation</Text>
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No change orders yet.</Text>}
          renderItem={({ item }) => {
            const s = STATUS[item.status];
            return (
              <Card style={{ gap: 6, marginBottom: 10 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.desc}>
                    {item.reference ? `${item.reference} · ` : ''}
                    {item.description}
                  </Text>
                  <Pill label={s.label} tone={s.tone} />
                </View>
                <Text style={styles.meta}>
                  {impact(item.costImpactCents, item.timeImpactDays)}
                  {item.raiserName ? ` · by ${item.raiserName}` : ''}
                </Text>
                {canManage && item.status === 'submitted' && (
                  <View style={styles.decideRow}>
                    <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => decide(item, true)}>
                      <Text style={styles.btnPrimaryText}>Approve</Text>
                    </Pressable>
                    <Pressable style={styles.btn} onPress={() => decide(item, false)}>
                      <Text style={[styles.btnText, { color: colors.danger }]}>Reject</Text>
                    </Pressable>
                  </View>
                )}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, ...contentWidth },
    emptyWrap: { padding: 16, ...contentWidth },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center', marginTop: 24 },
    formLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: font.body,
      color: c.text,
    },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    desc: { flex: 1, fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    meta: { fontSize: 12, fontFamily: font.body, color: c.muted },
    decideRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    btn: {
      borderRadius: radius.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnText: { fontFamily: font.bodyBold, fontSize: 14, color: c.text },
    btnPrimary: { backgroundColor: c.text, borderColor: c.text },
    btnPrimaryText: { color: c.bg, fontFamily: font.bodyBold, fontSize: 14 },
  });
