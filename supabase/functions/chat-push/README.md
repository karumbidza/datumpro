# chat-push

Fans a new chat message out to its recipients' **offline** devices — Web Push for
browsers, the Expo push service for the mobile app. Online recipients already
receive the message over the Realtime private channel; this covers everyone else.

Recipients are resolved in the database by `public.chat_push_targets(message_id)`,
which is built on `public.chat_recipients(conversation_id)` — the same membership
rule the RLS policies enforce. The function never decides access itself.

## 1. Generate VAPID keys (Web Push)

```bash
npx web-push generate-vapid-keys
# → Public Key (put in the web app as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
# → Private Key (function secret only — never ship to the client)
```

## 2. Set function secrets

```bash
supabase secrets set \
  CHAT_PUSH_SECRET="$(openssl rand -hex 32)" \
  VAPID_PUBLIC_KEY="<public>" \
  VAPID_PRIVATE_KEY="<private>" \
  VAPID_SUBJECT="mailto:support@datumpro.app" \
  APP_URL="https://app.datumpro.com"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## 3. Deploy

```bash
supabase functions deploy chat-push
```

## 4. Trigger on new messages — pick ONE

**Dashboard (recommended).** Database → Webhooks → *Create*:

- Table `public.messages`, event **Insert**
- Type **Supabase Edge Functions** → `chat-push`, method `POST`
- HTTP header `x-webhook-secret: <the CHAT_PUSH_SECRET value>`

**SQL.** Apply `webhook.sql` after setting `app.chat_push_url` /
`app.chat_push_secret` (needs the `pg_net` extension).

## Notes

- Dead subscriptions (Web Push `404/410`, Expo `DeviceNotRegistered`) are pruned
  automatically.
- Delivery is best-effort and isolated from the write — a push failure can never
  roll back the message insert.
- Payload sent to clients: `{ title, body, url, conversationId }`. The service
  worker (`apps/web/public/sw.js`) shows the notification and deep-links to `url`.
