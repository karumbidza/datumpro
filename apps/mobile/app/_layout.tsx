import 'react-native-url-polyfill/auto';
import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SessionProvider, useSession } from '../lib/auth';

/** Redirects between the sign-in screen and the app based on session state. */
function AuthGate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const first = (segments as string[])[0]; // undefined on the index route
    const inAuthScreen = first === 'sign-in';
    const inApp = first === '(app)';
    if (!session) {
      if (!inAuthScreen) router.replace('/sign-in');
    } else if (!inApp) {
      router.replace('/(app)/tasks');
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Slot />;
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <AuthGate />
    </SessionProvider>
  );
}
