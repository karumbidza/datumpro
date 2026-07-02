import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { listMyTasks, type MyTask } from '../../lib/data/tasks';
import { Badge } from '../../components/badge';
import { formatDate, slaLabel, slaTone, statusLabel } from '../../lib/ui';

export default function Tasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await listMyTasks();
    setTasks(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever the screen regains focus (e.g. back from a detail).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          ),
        }}
      />

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
          ListEmptyComponent={<Text style={styles.empty}>No open tasks assigned to you.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/(app)/task/${item.id}`)}>
              <Text style={styles.project}>{item.projectName}</Text>
              <Text style={styles.title}>{item.title}</Text>
              <View style={styles.metaRow}>
                <Badge label={slaLabel(item.slaStatus)} tone={slaTone(item.slaStatus)} />
                <Text style={styles.meta}>
                  {statusLabel(item.status)} · due {formatDate(item.dueDate)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fafafa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 12, gap: 10 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#71717a', fontSize: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 14,
    gap: 6,
  },
  project: { fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 15, fontWeight: '600', color: '#18181b' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  meta: { fontSize: 12, color: '#71717a' },
  signOut: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
