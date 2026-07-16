import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../../lib/theme';
import { listInbox } from '../../../lib/data/chat';
import { unreadNotificationCount } from '../../../lib/data/notifications';

export default function TabsLayout() {
  const [unread, setUnread] = useState(0);
  const [notif, setNotif] = useState(0);

  // Keep the Messages + More tab badges fresh — poll on an interval and on
  // every return to the foreground.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [items, n] = await Promise.all([listInbox(), unreadNotificationCount()]);
        if (!active) return;
        setUnread(items.reduce((sum, i) => sum + i.unread, 0));
        setNotif(n);
      } catch {
        /* ignore transient errors */
      }
    };
    void load();
    const iv = setInterval(load, 20_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load());
    return () => {
      active = false;
      clearInterval(iv);
      sub.remove();
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.subtle,
        tabBarStyle: {
          backgroundColor: theme.color.card,
          borderTopColor: theme.color.border,
          height: 84,
          paddingTop: 6,
          paddingBottom: 28,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.color.accent, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: 'Payments',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarBadge: notif > 0 ? (notif > 99 ? '99+' : notif) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.color.accent, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
