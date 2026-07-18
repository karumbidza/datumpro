import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../components/brand-loader';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import {
  listNotifications,
  markAllNotificationsRead,
  type AppNotification,
} from '../../lib/data/notifications';
import { contentWidth, radius, font, type Colors } from '../../lib/theme';
import { useTheme } from '../../lib/theme-context';

function relTime(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function Notifications() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setItems(await listNotifications());
    setLoading(false);
    setRefreshing(false);
    // Opening the feed clears the unread state.
    void markAllNotificationsRead();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function open(n: AppNotification) {
    if (n.entityType === 'task' && n.entityId) router.push(`/(app)/task/${n.entityId}`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
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
          ListEmptyComponent={<Text style={styles.empty}>You're all caught up.</Text>}
          renderItem={({ item }) => (
            <Pressable style={[styles.item, !item.readAt && styles.unreadItem]} onPress={() => open(item)}>
              <View style={styles.itemHead}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.time}>{relTime(item.createdAt)}</Text>
              </View>
              {item.body && (
                <Text style={styles.body} numberOfLines={3}>
                  {item.body}
                </Text>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: 16, gap: 8, ...contentWidth },
    emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body },
    item: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
    },
    unreadItem: { borderColor: c.brand, backgroundColor: c.brandSoft },
    itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    itemTitle: { flex: 1, fontSize: 15, fontFamily: font.bodyBold, color: c.text },
    time: { fontSize: 11, fontFamily: font.body, color: c.subtle },
    body: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 3 },
  });
