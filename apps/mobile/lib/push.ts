import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/** Show notifications while the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 54 split shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Register this device for push and store its Expo token in push_subscriptions
 * (platform 'expo'), so the chat-push Edge Function can reach it. Best-effort and
 * silent: it no-ops on simulators, when permission is denied, or when there's no
 * EAS projectId (i.e. plain Expo Go) — push only fully works in a dev/production
 * build. Safe to call on every app open.
 */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const pid = projectId();
    if (!pid) {
      console.info('[push] no EAS projectId — skipping token registration (expected in Expo Go)');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    if (!token) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        platform: 'expo',
        endpoint: token,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,endpoint' },
    );
  } catch (e) {
    console.warn('[push] registration skipped:', e instanceof Error ? e.message : e);
  }
}
