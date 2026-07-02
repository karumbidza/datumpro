import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { listProjectTasks, type MyTask } from '../../../lib/data/tasks';
import { TaskCard } from '../../../components/task-card';
import { theme } from '../../../lib/theme';

export default function ProjectScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setTasks(await listProjectTasks(String(id)));
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name ?? 'Project' }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          contentContainerStyle={tasks.length === 0 ? styles.emptyWrap : styles.listContent}
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
            tasks.length > 0 ? <Text style={styles.count}>{tasks.length} tasks</Text> : null
          }
          ListEmptyComponent={<Text style={styles.empty}>No tasks in this project yet.</Text>}
          renderItem={({ item }) => <TaskCard task={item} subtitle={`Priority: ${item.priority}`} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10 },
  count: { fontSize: 12, color: theme.color.subtle, marginBottom: 4 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.color.subtle, fontSize: 14 },
});
