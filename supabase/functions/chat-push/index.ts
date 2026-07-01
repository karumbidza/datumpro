// ─────────────────────────────────────────────────────────────────────────────
// DatumPro — chat-push Edge Function
//
// Invoked by a Database Webhook on INSERT into public.messages. It resolves the
// offline recipients (via the SECURITY DEFINER chat_push_targets function, which
// mirrors the same RLS predicate that guards the conversation), then fans the
// notification out to each device: Web Push (VAPID) for browsers, the Expo Push
// service for the mobile app. Stale subscriptions (410 / DeviceNotRegistered) are
// pruned so the list stays healthy.
//
// Runs with the service role. Authorization is never re-implemented here — the
// database decides who may hear about a message.
//
// Required function secrets (supabase secrets set …):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided automatically)
//   CHAT_PUSH_SECRET     shared secret; the webhook must send it as x-webhook-secret
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (web push)
//   APP_URL              e.g. https://app.datumpro.com  (deep-link base)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: { id: string; conversation_id: string; sender_id: string; body: string | null } | null;
}

interface Target {
  subscription_id: string;
  user_id: string;
  platform: 'web' | 'expo';
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CHAT_PUSH_SECRET = Deno.env.get('CHAT_PUSH_SECRET') ?? '';
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

/** Trim a message body to a notification-safe snippet. */
function snippet(body: string | null, hasNoBody: boolean): string {
  if (hasNoBody) return '📎 Sent an attachment';
  const t = (body ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t || 'New message';
}

async function pruneSubscription(id: string) {
  await admin.from('push_subscriptions').delete().eq('id', id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Gate: the webhook proves it is ours with a shared secret header.
  if (!CHAT_PUSH_SECRET || req.headers.get('x-webhook-secret') !== CHAT_PUSH_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (payload.type !== 'INSERT' || payload.table !== 'messages' || !payload.record) {
    return json({ skipped: true });
  }
  const message = payload.record;

  // Build the notification's title / deep-link from the conversation + sender.
  const [{ data: conv }, { data: sender }, { count: attachCount }] = await Promise.all([
    admin
      .from('conversations')
      .select('id, type, project_id, task_id')
      .eq('id', message.conversation_id)
      .single(),
    admin.from('profiles').select('display_name, email').eq('id', message.sender_id).single(),
    admin
      .from('message_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('message_id', message.id),
  ]);
  if (!conv) return json({ skipped: 'no conversation' });

  const senderName = sender?.display_name || sender?.email?.split('@')[0] || 'Someone';
  const [{ data: project }, { data: task }] = await Promise.all([
    admin.from('projects').select('name').eq('id', conv.project_id).single(),
    conv.task_id
      ? admin.from('tasks').select('title').eq('id', conv.task_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const title =
    conv.type === 'task_dm'
      ? `${senderName} · ${task?.title ?? 'Task discussion'}`
      : `${senderName} · ${project?.name ?? 'Project chat'}`;
  const bodyText = snippet(message.body, !message.body && (attachCount ?? 0) > 0);
  const url =
    conv.type === 'task_dm' && conv.task_id
      ? `${APP_URL}/projects/${conv.project_id}/tasks/${conv.task_id}`
      : `${APP_URL}/projects/${conv.project_id}/chat`;

  // Recipients' devices (RLS-equivalent set, minus the sender, minus already-read).
  const { data: targets, error } = await admin.rpc('chat_push_targets', { p_message_id: message.id });
  if (error) return json({ error: error.message }, 500);
  const list = (targets ?? []) as Target[];
  if (list.length === 0) return json({ delivered: 0 });

  let delivered = 0;
  let pruned = 0;

  await Promise.all(
    list.map(async (t) => {
      try {
        if (t.platform === 'web') {
          if (!VAPID_PUBLIC || !VAPID_PRIVATE || !t.p256dh || !t.auth) return;
          await webpush.sendNotification(
            { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
            JSON.stringify({ title, body: bodyText, url, conversationId: conv.id }),
            { TTL: 60 * 60 * 24 },
          );
          delivered++;
        } else {
          // Expo push service.
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'accept-encoding': 'gzip, deflate',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              to: t.endpoint,
              title,
              body: bodyText,
              sound: 'default',
              data: { url, conversationId: conv.id },
            }),
          });
          const out = await res.json().catch(() => null);
          const status = out?.data?.status ?? (res.ok ? 'ok' : 'error');
          const errCode = out?.data?.details?.error;
          if (status === 'error' && errCode === 'DeviceNotRegistered') {
            await pruneSubscription(t.subscription_id);
            pruned++;
          } else if (res.ok) {
            delivered++;
          }
        }
      } catch (e) {
        // Web Push: 404/410 mean the subscription is dead — prune it.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await pruneSubscription(t.subscription_id);
          pruned++;
        }
      }
    }),
  );

  return json({ delivered, pruned, targets: list.length });
});
