# Deploying DatumPro

DatumPro is a pnpm/turbo monorepo. The **web app** (`apps/web`, Next.js 15)
deploys to **Vercel**; its backend is **Supabase** (Postgres + Auth + Storage +
Realtime). Transactional email is **Resend**, scheduled jobs are **Vercel Cron**,
and push notifications run through one **Supabase Edge Function** (`chat-push`).
The **mobile app** (`apps/mobile`, Expo) ships separately via EAS — see the end.

> There is **no Inngest**. Background work is Vercel Cron (`/api/cron/*`) plus the
> `chat-push` edge function. Nothing else to provision.

Order matters: **Supabase → Resend → Vercel → Edge Function → verify.**

---

## 0. Prerequisites

- Accounts: [Supabase](https://supabase.com), [Vercel](https://vercel.com),
  [Resend](https://resend.com). A domain you can add DNS records to.
- Local CLIs (only for the DB load and edge function):
  `npm i -g supabase` and `npx web-push` (no install needed).
- The GitHub repo connected to Vercel.

---

## 1. Supabase (database + auth + storage)

1. **Create a project** → note the **Project URL** and, under *Settings → API*,
   the **anon/publishable key** and the **service_role key** (secret).
2. **Load the schema.** Open *SQL Editor* and run the full
   [`supabase/bootstrap.sql`](supabase/bootstrap.sql) — it is a self-contained
   snapshot of every migration (tables, RLS, helpers, storage policies, the
   chat/push objects, and the payment-claim functions). It expects the native
   `auth` / `storage` / `realtime` schemas, which a real Supabase project already
   has.
   - Alternatively, if you use the Supabase CLI: `supabase db push` to apply
     `supabase/migrations/*` in order. Both routes converge on the same schema.
3. **Storage buckets.** `bootstrap.sql` inserts the required bucket(s) and their
   RLS. Confirm under *Storage* that they exist (project media / chat media).
4. **Auth.** *Authentication → URL Configuration*: set **Site URL** to your final
   web origin (e.g. `https://app.datumpro.com`) and add it to **Redirect URLs**.
   Enable Email (and any OAuth providers you want).

---

## 2. Resend (email)

1. *Domains → Add domain*, then add the DNS records it shows (SPF/DKIM). Wait for
   **Verified**.
2. *API Keys → Create* → this is `RESEND_API_KEY`.
3. Pick a from address on the verified domain, e.g.
   `DatumPro <no-reply@yourdomain.com>` → this is `RESEND_FROM_EMAIL`.

Invites and notification emails won't send until the domain is verified.

---

## 3. Vercel (web app)

1. **Import** the GitHub repo into Vercel.
2. **Root Directory:** set to **`apps/web`** (Settings → General). This is the one
   setting that makes the monorepo build correctly — Vercel installs the whole
   pnpm workspace from the repo root and builds Next from `apps/web`.
3. **Framework:** Next.js (auto-detected). Build/Install/Output commands: leave as
   default — `next build`, `pnpm install`, `.next`. The shared package is
   TypeScript source transpiled by Next (`transpilePackages`), so nothing to
   pre-build. `apps/web/vercel.json` already carries the cron schedule and a
   `turbo-ignore` rule so **mobile-only** commits don't trigger a web redeploy.
4. **Environment Variables** (Settings → Environment Variables) — from
   [`apps/web/.env.example`](apps/web/.env.example):

   | Variable | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | public |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable key | public |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **secret** |
   | `NEXT_PUBLIC_APP_URL` | your web origin | e.g. `https://app.datumpro.com` |
   | `RESEND_API_KEY` | Resend key | **secret** |
   | `RESEND_FROM_EMAIL` | verified from address | |
   | `CRON_SECRET` | long random string | **secret** — guards `/api/cron/*` |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key (§4) | optional (push) |
   | `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Sentry DSNs | optional |

   Set `NEXT_PUBLIC_APP_URL` to your real domain **before** the first deploy so
   email links are correct. Vercel provides `NODE_ENV` automatically.
5. **Deploy.** Vercel builds and gives you a `*.vercel.app` URL.
6. **Cron** is picked up from `vercel.json` automatically (SLA scan hourly, digest
   daily 07:00 UTC). Vercel signs each request with `Authorization: Bearer
   $CRON_SECRET`; the routes reject anything else, and refuse to run if the secret
   is unset — so make sure `CRON_SECRET` is set.

---

## 4. Push notifications (optional — the notification bell / mobile push)

Skip if you don't want push yet; the app works without it. Full detail in
[`supabase/functions/chat-push/README.md`](supabase/functions/chat-push/README.md).

1. **VAPID keys:** `npx web-push generate-vapid-keys`. Public → the web env var
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (redeploy web). Private → function secret below.
2. **Function secrets:**
   ```bash
   supabase secrets set \
     CHAT_PUSH_SECRET="$(openssl rand -hex 32)" \
     VAPID_PUBLIC_KEY="<public>" \
     VAPID_PRIVATE_KEY="<private>" \
     VAPID_SUBJECT="mailto:support@yourdomain.com" \
     APP_URL="https://app.datumpro.com"
   ```
   (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
3. **Deploy:** `supabase functions deploy chat-push`.
4. **Trigger:** *Database → Webhooks → Create* on `public.messages` **Insert** →
   Edge Function `chat-push`, header `x-webhook-secret: <CHAT_PUSH_SECRET>`.

---

## 5. Verify

- `GET https://<your-domain>/api/health` → `{ "ok": true, ... }`.
- Sign up → you land in onboarding; create an organisation.
- **Members → invite** an email → the invitee receives a Resend email with an
  accept link (confirms Resend + `NEXT_PUBLIC_APP_URL`).
- Create a project + task; award a quote → contractor sees draws under **My
  payments** and can submit a claim.
- **Cron smoke test** (optional):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sla
  ```
  → `{ "ok": true, ... }`. Without the header you should get `401`.

---

## 6. Mobile app (Expo / EAS) — separate track

The mobile app is **not** deployed to Vercel. It builds with **EAS Build** (no Mac
needed) and ships to the App Store / Play Store.

1. In `apps/mobile`, point the Supabase client env at the **same** project
   (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `app.config`
   or `.env` — check `apps/mobile/lib/supabase.ts`).
2. `npm i -g eas-cli && eas login && eas build:configure`.
3. `eas build --platform all` → submit with `eas submit`.

Because both apps talk to the same Supabase project, chat, tasks, and payments
stay in sync across web and mobile automatically.
