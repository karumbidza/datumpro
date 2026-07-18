import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { registerForPush } from '../../lib/push';
import { font } from '../../lib/theme';
import { useTheme } from '../../lib/theme-context';

export default function AppLayout() {
  const { colors } = useTheme();
  // We're past the auth gate here, so a session exists — register for push once.
  useEffect(() => {
    void registerForPush();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: font.displayBold },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="new-task" options={{ title: 'New task', presentation: 'modal' }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="chat/[taskId]" options={{ title: 'Task discussion' }} />
    </Stack>
  );
}
