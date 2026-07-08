# Rollout — Member types, access hardening & auth

A hand-off for shipping this batch of changes to production. Two parts:
**what changed** (context) and **what to deploy** (the checklist you must run —
none of it happens automatically).

Commits: `eee689c` → `bbb6ea6` on `main`.

---

## What changed

### Members & access
- **Member type at invitation.** Inviting someone now picks a *type* — Admin,
  Project Manager, Finance, Staff, Contractor, Client, Viewer. The type sets the
  org role **and** caps the project roles they can ever hold (a Contractor can
  only be a project contractor/contributor; a Client only client/viewer).
  Enforced by a DB trigger, not just the UI. Editable later by admins.
- **No self-made project PMs.** A project-PM who isn't an org admin can no longer
  promote anyone to project-PM (that seat carries buy-side money powers). RLS
  `WITH CHECK` enforces it; delivery managers can still add contractors.
- **`/org/members` is admin-only** now (was: any member could read the roster).
- **Project Team page** aligned to the same model: role options filtered by
  member type, graceful inline errors, loading states.
- **Finance write UI gated** — "Add budget line" (budget:manage) and
  "New invoice" (invoice:create) only render for authorised roles. RLS was
  already blocking the actions; this removes dead buttons.
- **`viewer` no longer carries `finance:view`** — the permission map is now the
  single source of truth (behaviour unchanged; viewers still don't see finance).

### Auth — web
- **Google & LinkedIn sign-in** buttons on the auth screen (OAuth returns a
  verified email, so it skips email confirmation).
- **Invite/sign-up UX**: leads with "Create account" for invitees, graceful
  inline errors, no internal/dev instructions leaked to end users.
- Members page: invites no longer crash the page on error; success/echo banners.

### Auth — mobile (field app)
- **Email one-time-code sign-in** added alongside password. Fixes members who
  created their account with Google (no password) — they get a 6-digit code by
  email and sign in. Also covers unconfirmed emails / forgotten passwords.
- **EAS Update (OTA) configured** (`expo-updates`, update URL, fingerprint
  runtime, per-profile channels) so future JS changes ship without a rebuild.

---

## What to deploy / configure

Run these in order. Items marked **one-time** only need doing once.

### 1. Database (Supabase) — REQUIRED before the web app serves this build
Apply the new migration to prod:
```bash
supabase db push
# applies supabase/migrations/20260101002100_member_types_and_role_lock.sql
```
Adds the `member_type` enum + columns (backfilled from existing roles), the
project-PM RLS lock, and the member-type trigger. Validated on a throwaway
Postgres over the real prior functions.

### 2. Supabase Auth settings (dashboard) — one-time
- **Email → "Confirm email": ON** (verifies new-org email/password signups).
- **URL Configuration**
  - Site URL: `https://datumpro.app`
  - Redirect URLs: add `https://datumpro.app/auth/callback` (and `…/**`).
- **Email Templates → Magic Link**: add the code token so the mobile email-code
  flow works, e.g. a line: `Your sign-in code is {{ .Token }}`.
  (Without it the email only contains a link and the code screen has nothing to
  enter.)
- **Google provider**: enable + paste client id/secret — see the Google section
  below.

### 3. Vercel (web) — one-time
- Env: `NEXT_PUBLIC_APP_URL = https://datumpro.app` (used to build the OAuth /
  confirmation redirect). Then redeploy.

### 4. Mobile (EAS)
- **One** new build (the installed app must include `expo-updates`):
  ```bash
  cd apps/mobile
  eas build --profile preview --platform android
  ```
- Thereafter, JS-only changes ship OTA:
  ```bash
  eas update --branch preview --message "…"
  ```
- **one-time**: create `apps/mobile/.env` (copy `.env.example`) with the
  publishable Supabase URL + anon key — `eas update` needs them (it doesn't read
  eas.json's build env).

---

## Rollback notes
- The DB migration is additive (new enum/columns/trigger/policy). The main
  behavioural change is the project-PM RLS lock + type trigger; to relax, drop
  `project_members_type_guard` and restore the previous `project_members_write`
  policy (`can_manage_project` without the role='pm' clause).
- All web/mobile changes are plain code — revert the relevant commit and redeploy
  (or `eas update` a prior bundle) to roll back.
