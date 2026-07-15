import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { listProjectTasks, canManageProjectById, type MyTask } from '../../../lib/data/tasks';
import { getProjectConversationId, getUnreadCount } from '../../../lib/data/chat';
import { TaskCard } from '../../../components/task-card';
import { theme, contentWidth } from '../../../lib/theme';
import { useResponsive } from '../../../lib/responsive';

export default function ProjectScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { columns, contentMaxWidth } = useResponsive();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [teamUnread, setTeamUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [rows, manage, conv] = await Promise.all([
      listProjectTasks(String(id)),
      canManageProjectById(String(id)),
      getProjectConversationId(String(id)),
    ]);
    setTasks(rows);
    setCanManage(manage);
    setTeamUnread(conv ? await getUnreadCount(conv) : 0);
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          title: name ?? 'Project',
          headerRight: () =>
            canManage ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/(app)/new-task', params: { projectId: String(id), projectName: name ?? '' } })
                }
                hitSlop={8}
              >
                <Ionicons name="add" size={26} color="#fff" />
              </Pressable>
            ) : null,
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={tasks}
          key={`cols-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          keyExtractor={(t) => t.id}
          contentContainerStyle={
            tasks.length === 0 ? styles.emptyWrap : [styles.listContent, { maxWidth: contentMaxWidth }]
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
          ListHeaderComponent={
            <View style={styles.header}>
              <Pressable
                style={styles.teamChat}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/project-chat/[projectId]',
                    params: { projectId: String(id), name: name ?? '' },
                  })
                }
              >
                <Ionicons name="chatbubbles-outline" size={18} color={theme.color.accent} />
                <Text style={styles.teamChatText}>Team channel</Text>
                {teamUnread > 0 && (
                  <View style={styles.unread}>
                    <Text style={styles.unreadText}>{teamUnread > 99 ? '99+' : teamUnread}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={theme.color.subtle} style={{ marginLeft: 'auto' }} />
              </Pressable>
              <Pressable
                style={styles.teamChat}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/variations/[projectId]',
                    params: { projectId: String(id), name: name ?? '' },
                  })
                }
              >
                <Ionicons name="git-compare-outline" size={18} color={theme.color.accent} />
                <Text style={styles.teamChatText}>Change orders</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.color.subtle} style={{ marginLeft: 'auto' }} />
              </Pressable>
              {tasks.length > 0 && <Text style={styles.count}>{tasks.length} tasks</Text>}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No tasks in this project yet.</Text>}
          renderItem={({ item }) => (
            <View style={columns > 1 ? styles.col : undefined}>
              <TaskCard task={item} subtitle={`Priority: ${item.priority}`} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10, ...contentWidth },
  row: { gap: 10 },
  col: { flex: 1 },
  header: { gap: 10, marginBottom: 4 },
  teamChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.color.card,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teamChatText: { fontSize: 15, fontWeight: '600', color: theme.color.text },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  count: { fontSize: 12, color: theme.color.subtle, marginBottom: 4 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.color.subtle, fontSize: 14 },
});
