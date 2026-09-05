// ─────────────────────────────────────────────────────────────────────────────
// DatumPro — notification-push Edge Function
//
// Invoked by a Database Webhook / trigger on INSERT into public.notifications.
// A notification row already names its single recipient (user_id) and carries a
// ready-made title / body / link, so — unlike chat-push — there is no recipient
// resolution to do here: we simply fan the row out to every device that user has
// registered. Web browsers get Web Push (VAPID); the mobile app gets an Expo push.
// Stale subscriptions (410 / DeviceNotRegistered) are pruned.
//
// This is the ONE place server-side notifications become phone pushes. Every
// origin that writes a notifications row — the web app, the mobile app, and the
// pg_cron reminder sweeps — reaches the phone through this function, so a caller
// never has to remember to push separately.
//
// Runs with the service role. Authorization is not re-checked: the notifications
// row was already created through the org-guarded notify() path (or the service
// role), so its mere existence is the permission to deliver it to its owner.
//
// Required function secrets (supabase secrets set …):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided automatically)
//   NOTIFICATION_PUSH_SECRET   shared secret; the trigger sends it as x-webhook-secret
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (web push)
//   APP_URL              e.g. https://app.datumpro.com  (deep-link base)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

interface NotificationRecord {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: NotificationRecord | null;
}

interface Subscription {
  id: string;
  platform: 'web' | 'expo';
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUSH_SECRET = Deno.env.get('NOTIFICATION_PUSH_SECRET') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@datumpro.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Turn a stored relative link (e.g. /projects/…/chat) into an absolute URL. */
function absoluteUrl(link: string | null): string {
  if (!link) return APP_URL || '';
  if (/^https?:\/\//i.test(link)) return link;
  return APP_URL ? `${APP_URL}${link.startsWith('/') ? '' : '/'}${link}` : link;
}

async function pruneSubscription(id: string) {
  await admin.from('push_subscriptions').delete().eq('id', id);
}

/** Run fn over items with bounded concurrency (sequential batches) so a large
 *  target list can't blow the function duration or burst the push services. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Gate: the trigger proves it is ours with a shared secret header.
  if (!PUSH_SECRET || req.headers.get('x-webhook-secret') !== PUSH_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (payload.type !== 'INSERT' || payload.table !== 'notifications' || !payload.record) {
    return json({ skipped: true });
  }
  const n = payload.record;

  const title = n.title;
  const bodyText = (n.body ?? '').trim();
  const url = absoluteUrl(n.link);

  // Every device this user has registered.
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, platform, endpoint, p256dh, auth')
    .eq('user_id', n.user_id);
  if (error) return json({ error: error.message }, 500);
  const subs = (data ?? []) as Subscription[];
  if (subs.length === 0) return json({ delivered: 0 });

  let delivered = 0;
  let pruned = 0;

  await inBatches(subs, 8, async (s) => {
      try {
        if (s.platform === 'web') {
          if (!VAPID_PUBLIC || !VAPID_PRIVATE || !s.p256dh || !s.auth) return;
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body: bodyText, url, notificationId: n.id }),
            { TTL: 60 * 60 * 24 },
          );
          delivered++;
        } else {
          // Expo push service — target the same HIGH-importance channel the app
          // registers ('messages_v2') so it's a heads-up banner with sound.
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'accept-encoding': 'gzip, deflate',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              to: s.endpoint,
              title,
              body: bodyText,
              sound: 'default',
              channelId: 'messages_v2',
              priority: 'high',
              data: { url, notificationId: n.id },
            }),
          });
          const out = await res.json().catch(() => null);
          const status = out?.data?.status ?? (res.ok ? 'ok' : 'error');
          const errCode = out?.data?.details?.error;
          if (status === 'error' && errCode === 'DeviceNotRegistered') {
            await pruneSubscription(s.id);
            pruned++;
          } else if (res.ok) {
            delivered++;
          }
        }
      } catch (e) {
        // Web Push: 404/410 mean the subscription is dead — prune it.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await pruneSubscription(s.id);
          pruned++;
        }
      }
  });

  return json({ delivered, pruned, targets: subs.length });
});
