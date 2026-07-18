import 'react-native-url-polyfill/auto';
import { BrandLoader } from '../components/brand-loader';
import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar, setStatusBarHidden } from 'expo-status-bar';
import { AppState, Platform, View } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { SessionProvider, useSession } from '../lib/auth';
import { ThemeProvider } from '../lib/theme-context';

/** Android immersive mode: hide the status + navigation bars for a true
 *  fullscreen view; a swipe from the edge reveals them transiently
 *  ("overlay-swipe"), after which Android hides them again. We re-assert on
 *  every return to the foreground because the OS restores the bars when the app
 *  is backgrounded, and after some system interactions (keyboard, permissions). */
function useImmersiveAndroid() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const apply = () => {
      // Wrapped: in edge-to-edge builds some setters warn/no-op — never let that
      // crash the app.
      void NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});
      void NavigationBar.setVisibilityAsync('hidden').catch(() => {});
      setStatusBarHidden(true, 'fade');
    };

    apply();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply();
    });
    return () => sub.remove();
  }, []);
}

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
      router.replace('/(app)/(tabs)');
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <BrandLoader />
      </View>
    );
  }
  return <Slot />;
}

export default function RootLayout() {
  useImmersiveAndroid();
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const fontsReady = fontsLoaded || !!fontError;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <StatusBar style="auto" hidden />
          {fontsReady ? (
            <AuthGate />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <BrandLoader />
            </View>
          )}
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
