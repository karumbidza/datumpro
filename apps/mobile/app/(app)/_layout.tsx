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
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="tasks" options={{ title: 'My Tasks' }} />
    </Stack>
  );
}
