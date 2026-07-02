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

A QR code appears in the terminal. Open **Expo Go** on your phone and scan it
(Android: scan from inside Expo Go · iOS: scan with the Camera app). The app loads
over your local network — your phone and computer must be on the same Wi-Fi. Edit a
file and it hot-reloads instantly.

> Runs today in Expo Go: sign-in, My Tasks, task detail, and real-time task chat.

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
```
