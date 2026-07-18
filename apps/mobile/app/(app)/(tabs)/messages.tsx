import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, TextInput, SectionList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { listInbox, type InboxItem } from '../../../lib/data/chat';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
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
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [query, setQuery] = useState('');
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
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
    const project = filtered.filter((i) => i.type === 'project');
    const tasks = filtered.filter((i) => i.type === 'task_dm');
    return [
      { title: 'Project chats', data: project },
      { title: 'Task discussions', data: tasks },
    ].filter((s) => s.data.length > 0);
  }, [items, query]);

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
      <View style={[styles.head, { maxWidth: contentMaxWidth }]}>
        <Text style={styles.title}>Messages</Text>
        <View style={[styles.search, scheme === 'light' && styles.shadow]}>
          <Ionicons name="search" size={18} color={colors.subtle} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations"
            placeholderTextColor={colors.subtle}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.subtle} />
            </Pressable>
          )}
        </View>
      </View>

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
            sections.length === 0 ? styles.emptyWrap : [styles.listContent, { maxWidth: contentMaxWidth }]
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
          ListEmptyComponent={
            <Text style={styles.empty}>{query.trim() ? 'No matching conversations.' : 'No conversations yet.'}</Text>
          }
          renderSectionHeader={({ section }) => <Text style={styles.sectionHead}>{section.title}</Text>}
          renderItem={({ item }) => {
            const isProject = item.type === 'project';
            return (
              <Pressable
                style={({ pressed }) => [styles.card, scheme === 'light' && styles.shadow, pressed && styles.pressed]}
                onPress={() => open(item)}
              >
                <View style={[styles.icon, isProject ? styles.iconProject : styles.iconTask]}>
                  <Ionicons
                    name={isProject ? 'people' : 'chatbubble-ellipses'}
                    size={18}
                    color={isProject ? colors.brandDeep : colors.accentDeep}
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
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    head: { paddingHorizontal: 20, paddingTop: 8, ...contentWidth },
    title: { fontSize: 26, fontFamily: font.displayBold, color: c.text, paddingBottom: 14 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 14,
      height: 46,
      marginBottom: 4,
    },
    searchInput: { flex: 1, fontSize: 15, fontFamily: font.body, color: c.text, paddingVertical: 0 },
    shadow: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, ...contentWidth },
    sectionHead: {
      fontSize: 11,
      fontFamily: font.bodyBold,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: c.subtle,
      paddingTop: 16,
      paddingBottom: 8,
    },
    emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body },
    sep: { height: 8 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 12,
    },
    pressed: { opacity: 0.85 },
    icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    iconProject: { backgroundColor: c.brandSoft },
    iconTask: { backgroundColor: c.accentSoft },
    body: { flex: 1, gap: 3, minWidth: 0 },
    line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { flex: 1, fontSize: 15, fontFamily: font.bodyBold, color: c.text },
    nameUnread: { fontFamily: font.bodyHeavy },
    time: { fontSize: 12, fontFamily: font.body, color: c.subtle },
    preview: { flex: 1, fontSize: 13, fontFamily: font.body, color: c.muted },
    previewUnread: { color: c.text, fontFamily: font.bodySemi },
    unread: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadText: { color: c.onAccent, fontSize: 11, fontFamily: font.bodyBold },
  });
