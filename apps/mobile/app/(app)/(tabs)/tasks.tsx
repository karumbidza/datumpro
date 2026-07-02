import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { listMyTasks, type MyTask } from '../../../lib/data/tasks';
import { Pill, ProgressBar } from '../../../components/ui';
import { formatDate, slaLabel, statusLabel } from '../../../lib/ui';
import { theme, slaTone, statusProgress } from '../../../lib/theme';

type Filter = 'all' | 'in_progress' | 'completed' | 'overdue';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
];

const today = () => new Date().toISOString().slice(0, 10);

function statusIcon(status: string): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'done':
      return 'checkmark-done';
    case 'submitted':
      return 'hourglass-outline';
    case 'blocked':
      return 'alert-circle-outline';
    case 'in_progress':
      return 'construct-outline';
    default:
      return 'ellipse-outline';
  }
}

export default function Tasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setTasks(await listMyTasks());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const counts = useMemo(() => {
    const t = today();
    return {
      all: tasks.length,
      in_progress: tasks.filter((x) => x.status === 'in_progress').length,
      completed: tasks.filter((x) => x.status === 'done').length,
      overdue: tasks.filter((x) => x.status !== 'done' && x.dueDate && x.dueDate < t).length,
    };
  }, [tasks]);

  const visible = useMemo(() => {
    const t = today();
    switch (filter) {
      case 'in_progress':
        return tasks.filter((x) => x.status === 'in_progress');
      case 'completed':
        return tasks.filter((x) => x.status === 'done');
      case 'overdue':
        return tasks.filter((x) => x.status !== 'done' && x.dueDate && x.dueDate < t);
      default:
        return tasks;
    }
  }, [tasks, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Tasks</Text>

      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label} ({counts[f.key]})
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => t.id}
          contentContainerStyle={visible.length === 0 ? styles.emptyWrap : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>Nothing here.</Text>}
          renderItem={({ item }) => {
            const tone = slaTone(item.slaStatus);
            const pct = statusProgress(item.status);
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/(app)/task/${item.id}`)}>
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
                    <Ionicons name={statusIcon(item.status)} size={18} color={tone.fg} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {item.projectName}
                    </Text>
                  </View>
                  <Pill label={slaLabel(item.slaStatus)} tone={tone} />
                </View>

                <View style={styles.cardMeta}>
                  <Ionicons name="calendar-outline" size={13} color={theme.color.subtle} />
                  <Text style={styles.metaText}>due {formatDate(item.dueDate)}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>{statusLabel(item.status)}</Text>
                </View>

                <View style={styles.progressRow}>
                  <ProgressBar value={pct} color={tone.bar} />
                  <Text style={styles.pct}>{pct}%</Text>
                </View>
              </Pressable>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: theme.color.card,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.dark, borderColor: theme.color.dark },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.muted },
  chipTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.color.subtle, fontSize: 14 },
  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.color.text },
  cardSub: { fontSize: 12, color: theme.color.subtle, marginTop: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: theme.color.muted },
  metaDot: { color: theme.color.subtle },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pct: { fontSize: 12, fontWeight: '700', color: theme.color.text, width: 38, textAlign: 'right' },
});
