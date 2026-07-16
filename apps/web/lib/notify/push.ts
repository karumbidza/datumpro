import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** Send an Expo push to every mobile device of the given users. Web devices rely
 *  on the in-app bell. Service-role read (push_subscriptions is own-rows under
 *  RLS). Best-effort — never throws. */
export async function sendExpoPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; url?: string | null },
): Promise<void> {
  try {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from('push_subscriptions')
      .select('endpoint')
      .eq('platform', 'expo')
      .in('user_id', ids);
    const tokens = ((data ?? []) as { endpoint: string }[]).map((r) => r.endpoint).filter(Boolean);
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      data: payload.url ? { url: payload.url } : {},
    }));

    // Expo accepts a batch of up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
        },
        body: JSON.stringify(messages.slice(i, i + 100)),
      }).catch(() => {});
    }
  } catch {
    /* push must never break the caller */
  }
}
