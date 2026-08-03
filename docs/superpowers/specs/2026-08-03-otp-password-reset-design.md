# OTP-code password reset — design

**Date:** 2026-08-03
**Status:** Approved, building

## Problem

The current "Forgot?" on `/sign-in` calls `resetPasswordForEmail` inline and emails a
magic **link** that lands on `/reset-password`. It's a two-device / leave-the-page
experience, and (until SMTP was fixed) delivered nothing. We want a self-contained,
single-device reset: enter email → receive a **6-digit code** → enter code → set new
password → land signed-in on the dashboard.

## Flow

In-page step swap inside the existing centered sign-in card. The sign-in page gains a
view state `'signin' | 'forgot'`. "Forgot?" → `'forgot'`; "← Back to sign in" → `'signin'`.

`ForgotPasswordFlow` is a 3-step state machine:

1. **Email** — `supabase.auth.resetPasswordForEmail(email)`. Neutral confirmation
   message (no account enumeration). → Step 2.
2. **Code** — 6-digit input → `supabase.auth.verifyOtp({ email, token, type: 'recovery' })`.
   On success a recovery **session** is established. "Resend code" (respects the 60s
   min-interval) and "← change email" affordances. → Step 3.
3. **New password** — new + confirm, validated with shared `passwordIssue()` (min 8) →
   `supabase.auth.updateUser({ password })`. The recovery session becomes a full session
   → redirect to `/dashboard` (via `safeNext()`).

## Error handling

- Invalid/expired code → "That code is incorrect or expired. Check the latest email or resend."
- verifyOtp session failure → offer restart at Step 1.
- Network errors → inline, retryable, entered state preserved.

## Dependency (dashboard, manual)

The **Reset Password** email template (Auth → Emails → Templates) must surface the code,
e.g. `Your DatumPro password reset code is: {{ .Token }}`. Until saved, the email shows a
link instead of a code.

## Scope

- Replace inline `forgotPassword()` in `apps/web/app/sign-in/page.tsx` with the view-state
  swap + new `apps/web/app/sign-in/forgot-password-flow.tsx` component.
- Keep `/reset-password` as a harmless fallback for any in-flight recovery links.
- Reuse the shared `passwordIssue()` helper.
- No DB/migration changes.

## Verification

No web test harness exists; verify via `turbo typecheck lint` + live test on datumpro.app
(trigger reset, confirm code email arrives, complete flow, land on dashboard).
