# Rollout — fixing mobile push notifications

**Symptom:** no in-app / system notifications on mobile from the latest build —
no sound, no banner, especially for messages and reminders, for all users.

**Diagnosis (verified against the live DB, 2026-07):** the app code is correct
end to end. Two *operational* gaps break delivery, plus one Android-channel
polish that's now fixed in code.

| # | Finding | Evidence | Fix owner |
|---|---------|----------|-----------|
| A | **No device ever registers an Expo push token** — so nothing can reach any phone. | `push_subscriptions` has **0** rows with `platform='expo'` (only 2 `web`). `getExpoPushTokenAsync()` throws at runtime because the Android build has **no Firebase/FCM config** (no `google-services.json`, no `android.googleServicesFile`, no FCM credential in EAS). | **Owner** — needs Firebase + EAS + a native rebuild (below). |
| B | **Chat message → push trigger is switched off.** | Trigger `chat_push_notify_trg` exists on `messages`, but the DB settings it reads (`app.chat_push_url`, `app.chat_push_secret`) are **unset**, so it returns early on every insert. No one gets chat push (web *or* mobile). | **Owner** — `ALTER DATABASE` needs the project owner role; the function secret needs the CLI/dashboard. |
| C | Reminders push is correct server-side (`sendExpoPushToUsers`, `sound:'default'`). It reaches no phone only because of **A**. | — | Resolves once **A** is done. |
| D | Android channel was `DEFAULT` importance → silent tray drop. | — | ✅ **Fixed in code** (`01baab2`): dedicated `messages` channel at HIGH importance + sound + vibration; server pushes now target it via `channelId`. |

---

## A. Register Expo push tokens (Android FCM) — required, includes a rebuild

Android remote push needs Firebase Cloud Messaging. Without it,
`getExpoPushTokenAsync()` fails silently and no token is stored.

1. **Create a Firebase project** (or reuse one) → add an **Android app** with
   package name **`app.datumpro.field`**. Download **`google-services.json`**.
2. Drop `google-services.json` into `apps/mobile/` and reference it in
   `app.json` under `expo.android`:
   ```json
   "android": {
     "package": "app.datumpro.field",
     "googleServicesFile": "./google-services.json",
     ...
   }
   ```
   (Do **not** commit `google-services.json` if you'd rather keep it out of git —
   add it to `.gitignore` and supply it in CI via an EAS secret file.)
3. **Give Expo the FCM V1 credential** so the Expo push service can deliver to
   FCM. In Firebase → Project settings → Service accounts → *Generate new private
   key* (a JSON). Then:
   ```bash
   cd apps/mobile
   eas credentials            # Android → Push Notifications → upload the FCM V1 service-account JSON
   ```
4. **Rebuild** (native config changed — OTA can't do this):
   ```bash
   eas build --profile preview --platform android
   ```
   Install the new APK, open the app, accept the notification permission.
5. **Verify a token landed:**
   ```sql
   select platform, count(*) from push_subscriptions group by platform;
   ```
   You should now see `expo` rows. A quick end-to-end test:
   [expo.dev/notifications](https://expo.dev/notifications) → paste the
   `ExponentPushToken[…]` → send. It should ring with a heads-up banner.

> iOS: APNs is set up automatically by `eas build` when the Apple account has a
> push key. Once a build registers, iOS tokens will appear the same way.

## B. Turn on the chat-message push trigger — no rebuild

Pick **one** shared secret and set it in **both** places so they match.

1. **Function secret** (CLI or Dashboard → Edge Functions → chat-push → Secrets):
   ```bash
   supabase secrets set CHAT_PUSH_SECRET='<your-secret>'
   # also confirm APP_URL is set, e.g.
   supabase secrets set APP_URL='https://app.datumpro.com'
   ```
2. **DB settings** — run in the SQL editor **as the owner** (`postgres`), then
   reconnect (or wait for pooler connections to recycle):
   ```sql
   alter database postgres set app.chat_push_url    = 'https://tpuewautmatwvmabomov.supabase.co/functions/v1/chat-push';
   alter database postgres set app.chat_push_secret = '<same secret as above>';
   ```
3. **Test:** send a chat message from one account; a recipient who isn't looking
   at that thread should get a push. Check function logs for `delivered > 0`.

> Web push additionally needs `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
> `VAPID_SUBJECT` set as function secrets — unrelated to mobile.

## Done when

- `push_subscriptions` shows `expo` rows after testers reinstall (A).
- A test message and a reminder both ring on a phone with sound + banner.
