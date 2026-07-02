import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { getHomeData, type HomeData } from '../../../lib/data/home';
import { Card, ProgressBar, StatTile, Avatar } from '../../../components/ui';
import { theme, contentWidth } from '../../../lib/theme';

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setData(await getHomeData());
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onTrack = data ? data.myOverdue === 0 : true;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandDot}>
            <Ionicons name="business" size={20} color="#fff" />
          </View>
          <Avatar name={data?.displayName ?? '?'} size={40} />
        </View>

        <Text style={styles.greeting}>
          Hey {data ? firstName(data.displayName) : '…'}, 👋
        </Text>
        <Text style={styles.subGreeting}>Here’s your project update.</Text>

        {/* Portfolio snapshot */}
        <Card style={{ marginTop: 18 }}>
          <Text style={styles.cardLabel}>Portfolio snapshot</Text>
          <Text style={styles.bigPct}>{data?.portfolioPct ?? 0}%</Text>
          <Text style={styles.cardHint}>
            {data ? `${data.doneTasks} of ${data.totalTasks} tasks complete` : 'Loading…'}
          </Text>
          <View style={styles.trackRow}>
            <ProgressBar value={data?.portfolioPct ?? 0} />
          </View>
          <View style={[styles.statusRow, { backgroundColor: onTrack ? theme.color.successSoft : theme.color.dangerSoft }]}>
            <View style={[styles.statusDot, { backgroundColor: onTrack ? theme.color.success : theme.color.danger }]} />
            <Text style={[styles.statusText, { color: onTrack ? theme.color.success : theme.color.danger }]}>
              {onTrack ? 'On track' : `${data?.myOverdue} overdue`}
            </Text>
          </View>
        </Card>

        {/* My stats */}
        <View style={styles.statRow}>
          <StatTile label="My open" value={data?.myOpen ?? 0} />
          <StatTile label="At risk" value={data?.myAtRisk ?? 0} accent={theme.color.warning} />
          <StatTile label="Overdue" value={data?.myOverdue ?? 0} accent={theme.color.danger} />
        </View>

        {/* Projects */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Projects</Text>
          <Text style={styles.sectionCount}>{data?.projects.length ?? 0}</Text>
        </View>
        {(data?.projects ?? []).length === 0 ? (
          <Text style={styles.empty}>No projects yet.</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {data!.projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() =>
                  router.push({ pathname: '/(app)/project/[id]', params: { id: p.id, name: p.name } })
                }
              >
                <Card>
                  <View style={styles.projRow}>
                    <Text style={styles.projName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={styles.projRight}>
                      <Text style={styles.projPct}>{p.pct}%</Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.color.subtle} />
                    </View>
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <ProgressBar value={p.pct} />
                  </View>
                  <Text style={styles.projMeta}>
                    {p.done}/{p.total} tasks done
                  </Text>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable style={styles.viewTasks} onPress={() => router.push('/(app)/(tabs)/tasks')}>
          <Text style={styles.viewTasksText}>View my tasks</Text>
          <Ionicons name="arrow-forward" size={16} color={theme.color.accent} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: 20, paddingBottom: 32, ...contentWidth },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandDot: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: { marginTop: 16, fontSize: 26, fontWeight: '800', color: theme.color.text },
  subGreeting: { fontSize: 26, fontWeight: '800', color: theme.color.muted, marginTop: -2 },
  cardLabel: { fontSize: 13, fontWeight: '600', color: theme.color.muted },
  bigPct: { fontSize: 44, fontWeight: '800', color: theme.color.text, marginTop: 2 },
  cardHint: { fontSize: 12, color: theme.color.subtle },
  trackRow: { flexDirection: 'row', marginTop: 12 },
  statusRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.color.text },
  sectionCount: { fontSize: 13, color: theme.color.subtle },
  empty: { color: theme.color.subtle, fontSize: 14 },
  projRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  projName: { fontSize: 15, fontWeight: '600', color: theme.color.text, flex: 1, marginRight: 8 },
  projRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  projPct: { fontSize: 15, fontWeight: '700', color: theme.color.accent },
  projMeta: { fontSize: 12, color: theme.color.subtle, marginTop: 6 },
  viewTasks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 12,
  },
  viewTasksText: { color: theme.color.accent, fontWeight: '700', fontSize: 14 },
});
