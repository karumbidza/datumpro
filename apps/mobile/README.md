# DatumPro Field (mobile)

One Expo / React Native codebase that produces **both** the Android and iOS apps.
It talks to the same Supabase backend as the web app (same login, same data, same
row-level security). No separate mobile server.

## Prerequisites

- Node 20+ and `pnpm` (already used by this repo)
- The **Expo Go** app on your phone (Android: Play Store · iOS: App Store) — this is
  all you need to *run* the app while developing; no Android Studio / Xcode required yet.

## 1. Configure the backend URL

Create `apps/mobile/.env` (copy from `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your anon / publishable key>
```

These are the same public values the web app uses.

## 2. Run it on your phone (development)

From the repo root:

```bash
pnpm --filter @datumpro/mobile dev
```

A QR code appears in the terminal.

- **iPhone:** open the built-in **Camera** app, point it at the QR, tap the yellow
  banner → it opens in Expo Go. (Do *not* scan from inside Expo Go — that's
  Android-only.)
- **Android:** scan from inside Expo Go.

Your phone and computer must be on the **same Wi-Fi**. Edit a file → it hot-reloads.

**Run it on your own computer, not in a cloud/remote shell** — your phone connects
to the dev server over the local network. If you only have the code in the cloud,
clone the repo to your machine first, then `pnpm install` and run the command above.

### If the QR won't connect (restrictive Wi-Fi, or running remotely)

```bash
pnpm --filter @datumpro/mobile dev:tunnel
```

Tunnel mode routes the connection through Expo's servers, so the phone connects even
on a different network. (First run may install `@expo/ngrok` — accept the prompt.)

> Runs today in Expo Go: sign-in, My Tasks, task detail, real-time task chat, and
> **site photo capture**. **Push notifications** need a dev build + an EAS
> projectId (see below) — they no-op silently in Expo Go.

## 3. Building real installable apps (later)

Photos (M4) and push notifications (M5) use native modules that aren't in Expo Go —
those need a **dev build**, and store releases need a **production build**. Both are
made in the cloud with **EAS Build** (no Mac required, even for iOS):

```bash
npm i -g eas-cli
eas login                 # free Expo account
eas build:configure
eas build --profile development --platform android   # or ios
eas build --profile production --platform all        # store-ready binaries
eas submit --platform android   # / ios — upload to the stores
```

### Store accounts you'll need
- **Google Play**: Google Play Developer account ($25, one-time)
- **Apple App Store**: Apple Developer Program ($99/year)

EAS builds the iOS binary in the cloud, so a Mac is optional.

## Project layout

```
app/                       expo-router screens (file = route)
  _layout.tsx              auth gate (redirects signed-out → /sign-in)
  sign-in.tsx              email + password
  (app)/tasks.tsx          My Tasks list
  (app)/task/[id].tsx      task detail
  (app)/chat/[taskId].tsx  real-time task chat
lib/                       supabase client, auth context, data + UI helpers
  push.ts                  Expo push-token registration (needs a dev build)
components/task-photos.tsx camera/library capture → project-media
```

## Enabling push notifications

Push requires a dev/production build and an EAS project. After `eas build:configure`,
EAS writes an `extra.eas.projectId` into the config — `lib/push.ts` reads it and
registers the device token into `push_subscriptions` (platform `expo`) on app open.
The existing `chat-push` Edge Function then delivers to the device. Nothing to wire
by hand beyond running the dev build.
