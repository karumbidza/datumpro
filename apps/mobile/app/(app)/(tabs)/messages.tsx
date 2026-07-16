import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, SectionList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { listInbox, type InboxItem } from '../../../lib/data/chat';
import { theme, contentWidth } from '../../../lib/theme';
import { useResponsive } from '../../../lib/responsive';

function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function Messages() {
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setItems(await listInbox());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const project = items.filter((i) => i.type === 'project');
    const tasks = items.filter((i) => i.type === 'task_dm');
    return [
      { title: 'Project chats', data: project },
      { title: 'Task discussions', data: tasks },
    ].filter((s) => s.data.length > 0);
  }, [items]);

  function open(item: InboxItem) {
    if (item.type === 'task_dm' && item.taskId) {
      router.push(`/(app)/chat/${item.taskId}`);
    } else {
      router.push({
        pathname: '/(app)/project-chat/[projectId]',
        params: { projectId: item.projectId, name: item.title },
      });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Messages</Text>

      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.conversationId}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={
            items.length === 0 ? styles.emptyWrap : [styles.listContent, { maxWidth: contentMaxWidth }]
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
          ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
          renderSectionHeader={({ section }) => <Text style={styles.sectionHead}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <View style={[styles.icon, item.type === 'project' ? styles.iconProject : styles.iconTask]}>
                <Ionicons
                  name={item.type === 'project' ? 'people' : 'chatbubble-ellipses'}
                  size={18}
                  color={item.type === 'project' ? theme.color.accent : '#4f46e5'}
                />
              </View>
              <View style={styles.body}>
                <View style={styles.line}>
                  <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.time}>{shortTime(item.lastAt)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                    {item.lastBody ?? item.subtitle}
                  </Text>
                  {item.unread > 0 && (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  title: { fontSize: 24, fontWeight: '800', color: theme.color.text, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingVertical: 8, ...contentWidth },
  sectionHead: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: theme.color.subtle,
    backgroundColor: theme.color.bg,
    paddingTop: 14,
    paddingBottom: 6,
  },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.color.subtle, fontSize: 14 },
  sep: { height: 1, backgroundColor: theme.color.border, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconProject: { backgroundColor: theme.color.accentSoft },
  iconTask: { backgroundColor: '#eef2ff' },
  body: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.color.text },
  nameUnread: { fontWeight: '800' },
  time: { fontSize: 12, color: theme.color.subtle },
  preview: { flex: 1, fontSize: 13, color: theme.color.muted },
  previewUnread: { color: theme.color.text, fontWeight: '500' },
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
});
