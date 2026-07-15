import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { listMyTasks, type MyTask } from '../../../lib/data/tasks';
import { TaskCard } from '../../../components/task-card';
import { theme, contentWidth } from '../../../lib/theme';
import { useResponsive } from '../../../lib/responsive';

type Filter = 'all' | 'in_progress' | 'completed' | 'overdue';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function Tasks() {
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

  const { columns, contentMaxWidth } = useResponsive();

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
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
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
          key={`cols-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          keyExtractor={(t) => t.id}
          contentContainerStyle={
            visible.length === 0 ? styles.emptyWrap : [styles.listContent, { maxWidth: contentMaxWidth }]
          }
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
          renderItem={({ item }) => (
            <View style={columns > 1 ? styles.col : undefined}>
              <TaskCard task={item} />
            </View>
          )}
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
  listContent: { padding: 16, gap: 10, ...contentWidth },
  row: { gap: 10 },
  col: { flex: 1 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.color.subtle, fontSize: 14 },
});
