# notification-push

Pushes **every in-app notification** to the recipient's devices — Web Push for
browsers, the Expo push service for the mobile app. This is the single place a
`public.notifications` row becomes a phone buzz, so **every** origin reaches the
device through one path: the web app, the mobile app, and the pg_cron reminder
sweeps (`remind_open_action_items`, the acceptance nudge).

A notification row already names its recipient (`user_id`) and carries a
ready-made `title` / `body` / `link`, so there is no membership resolution to do:
the function reads that user's `push_subscriptions` and fans the row out. The row
was created through the org-guarded `notify()` path (or the service role), so its
existence is the authorization to deliver it.

## 1. VAPID keys (Web Push)

Reuse the same keys as `chat-push` (one keypair per project). If you have not
generated them yet:

```bash
npx web-push generate-vapid-keys
```

## 2. Set function secrets

```bash
supabase secrets set \
  NOTIFICATION_PUSH_SECRET="$(openssl rand -hex 32)" \
  VAPID_PUBLIC_KEY="<public>" \
  VAPID_PRIVATE_KEY="<private>" \
  VAPID_SUBJECT="mailto:support@datumpro.app" \
  APP_URL="https://app.datumpro.com"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## 3. Deploy

```bash
supabase functions deploy notification-push
```

## 4. Fire on new notifications

The trigger ships in migration
`20260904090000_notification_push_webhook.sql` (`notification_push_notify` on
`INSERT` into `public.notifications`, over `pg_net`). Point it at the deployed
function by setting the two database settings once, as the project owner:

```sql
alter database postgres set app.notification_push_url    = 'https://<ref>.supabase.co/functions/v1/notification-push';
alter database postgres set app.notification_push_secret = '<same value as NOTIFICATION_PUSH_SECRET>';
```

Reconnect for the settings to take effect. Until the URL is set the trigger
no-ops, so it is safe on local / CI where `pg_net` or the function is absent.

(Prefer the SQL trigger here over a dashboard webhook: notifications are written
from cron and the mobile app too, and the in-database trigger catches every
origin uniformly.)

## Notes

- Dead subscriptions (Web Push `404/410`, Expo `DeviceNotRegistered`) are pruned
  automatically.
- Delivery is best-effort and isolated from the write — a push failure can never
  roll back the notification insert.
- Payload sent to clients: `{ title, body, url, notificationId }`. The web service
  worker (`apps/web/public/sw.js`) shows the notification and deep-links to `url`;
  the Expo push targets the app's `messages_v2` channel.
- The web app no longer pushes inline from `notifyUser()` — this trigger is the
  one fan-out point, so wiring it up is required for phone delivery in production.
