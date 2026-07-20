import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, currentUser} from './supabase';

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
      // HIGH importance is what makes Android show a heads-up banner AND play a
      // sound; DEFAULT drops it silently into the tray on many devices. The sound
      // + vibration are bound to the channel at creation, so this must match what
      // we want before the first notification arrives.
      // NOTE: Android freezes a channel's importance/sound at creation time — you
      // can't upgrade an existing channel from code. Existing installs already have
      // a low-importance 'default' channel, so we create a *new* id ('messages')
      // that server pushes target via `channelId`.
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages & reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
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

    const user = await currentUser();
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
