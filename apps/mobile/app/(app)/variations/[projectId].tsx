import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatUsd } from '@datumpro/shared/domain';
import { listVariations, type Variation } from '../../../lib/data/variations';
import { Card, Pill } from '../../../components/ui';
import { contentWidth, font, type Colors, type Tone } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function statusFor(c: Colors): Record<Variation['status'], { label: string; tone: Tone }> {
  return {
    pending: {
      label: 'pending',
      tone: { bg: c.accentSoft, fg: c.accentDeep, bar: c.accent },
    },
    approved: {
      label: 'approved',
      tone: { bg: c.successSoft, fg: c.success, bar: c.success },
    },
    rejected: {
      label: 'rejected',
      tone: { bg: c.dangerSoft, fg: c.danger, bar: c.danger },
    },
  };
}

export default function Variations() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const STATUS = useMemo(() => statusFor(colors), [colors]);
  const [rows, setRows] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await listVariations(String(projectId));
    setRows(list);
    setLoading(false);
    setRefreshing(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
        <FlatList
          data={rows}
          keyExtractor={(v) => v.id}
          contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
          }
          ListEmptyComponent={<Text style={styles.empty}>No variations on this project yet.</Text>}
          renderItem={({ item }) => {
            const s = STATUS[item.status];
            return (
              <Card style={{ gap: 6, marginBottom: 10 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.desc}>{item.title}</Text>
                  <Pill label={s.label} tone={s.tone} />
                </View>
                <Text style={styles.meta}>
                  {item.taskTitle} · {formatUsd(item.costCents)}
                </Text>
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
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    desc: { flex: 1, fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    meta: { fontSize: 12, fontFamily: font.body, color: c.muted },
  });
