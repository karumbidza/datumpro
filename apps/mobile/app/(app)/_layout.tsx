import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { registerForPush } from '../../lib/push';

export default function AppLayout() {
  // We're past the auth gate here, so a session exists — register for push once.
  useEffect(() => {
    void registerForPush();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0e0e10' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="chat/[taskId]" options={{ title: 'Task discussion' }} />
    </Stack>
  );
}
