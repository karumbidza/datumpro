import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { listMyTasks, type MyTask } from '../../../lib/data/tasks';
import { subtaskProgressForTasks } from '../../../lib/data/subtasks';
import { TaskCard } from '../../../components/task-card';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, { done: number; total: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const rows = await listMyTasks();
    setTasks(rows);
    setProgressMap(await subtaskProgressForTasks(rows.map((t) => t.id)));
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
    const q = query.trim().toLowerCase();
    let list = tasks;
    switch (filter) {
      case 'in_progress':
        list = tasks.filter((x) => x.status === 'in_progress');
        break;
      case 'completed':
        list = tasks.filter((x) => x.status === 'done');
        break;
      case 'overdue':
        list = tasks.filter((x) => x.status !== 'done' && x.dueDate && x.dueDate < t);
        break;
    }
    if (q) {
      list = list.filter((x) => x.title.toLowerCase().includes(q) || x.projectName.toLowerCase().includes(q));
    }
    return list;
  }, [tasks, filter, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Tasks</Text>

      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.subtle} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks"
            placeholderTextColor={colors.subtle}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.subtle} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label} ({counts[f.key]})
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
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
              tintColor={colors.brand}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>Nothing here.</Text>}
          renderItem={({ item }) => (
            <View style={columns > 1 ? styles.col : undefined}>
              <TaskCard task={item} progress={progressMap.get(item.id)} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    title: { fontSize: 26, fontFamily: font.displayBold, color: c.text, paddingHorizontal: 20, paddingTop: 8 },
    searchWrap: { paddingHorizontal: 20, paddingTop: 14 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    searchInput: { flex: 1, fontSize: 14, fontFamily: font.body, color: c.text, padding: 0 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 7,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 12, fontFamily: font.bodySemi, color: c.muted },
    chipTextActive: { color: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, gap: 10, ...contentWidth },
    row: { gap: 10 },
    col: { flex: 1 },
    emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body },
  });
