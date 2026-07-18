import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { listProjectTasks, canManageProjectById, type MyTask } from '../../../lib/data/tasks';
import { subtaskProgressForTasks } from '../../../lib/data/subtasks';
import { getProjectConversationId, getUnreadCount } from '../../../lib/data/chat';
import { TaskCard } from '../../../components/task-card';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { useResponsive } from '../../../lib/responsive';

export default function ProjectScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { columns, contentMaxWidth } = useResponsive();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, { done: number; total: number }>>(new Map());
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
    setProgressMap(await subtaskProgressForTasks(rows.map((t) => t.id)));
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
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
          headerRight: () =>
            canManage ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/(app)/new-task', params: { projectId: String(id), projectName: name ?? '' } })
                }
                hitSlop={8}
              >
                <Ionicons name="add" size={26} color={colors.text} />
              </Pressable>
            ) : null,
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
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
              tintColor={colors.brand}
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
                <Ionicons name="chatbubbles-outline" size={18} color={colors.brand} />
                <Text style={styles.teamChatText}>Team channel</Text>
                {teamUnread > 0 && (
                  <View style={styles.unread}>
                    <Text style={styles.unreadText}>{teamUnread > 99 ? '99+' : teamUnread}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={colors.subtle} style={{ marginLeft: 'auto' }} />
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
                <Ionicons name="git-compare-outline" size={18} color={colors.brand} />
                <Text style={styles.teamChatText}>Change orders</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.subtle} style={{ marginLeft: 'auto' }} />
              </Pressable>
              {tasks.length > 0 && <Text style={styles.count}>{tasks.length} tasks</Text>}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No tasks in this project yet.</Text>}
          renderItem={({ item }) => (
            <View style={columns > 1 ? styles.col : undefined}>
              <TaskCard task={item} subtitle={`Priority: ${item.priority}`} progress={progressMap.get(item.id)} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, gap: 10, ...contentWidth },
    row: { gap: 10 },
    col: { flex: 1 },
    header: { gap: 10, marginBottom: 4 },
    teamChat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    teamChatText: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    unread: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadText: { color: c.onBrand, fontSize: 11, fontFamily: font.bodyBold },
    count: { fontSize: 12, fontFamily: font.body, color: c.subtle, marginBottom: 4 },
    emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body },
  });
