'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { passwordIssue } from '@datumpro/shared/validation';

const fieldClass =
  'flex h-11 w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-[13px] text-sm text-zinc-900 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100';
const inputClass = 'flex-1 bg-transparent outline-none placeholder:text-zinc-400';
const primaryBtn =
  'h-[46px] w-full rounded-lg bg-brand-500 text-[14.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50';

type Step = 'email' | 'code' | 'password';

/** Self-contained password reset by 6-digit code (no leaving the page):
 *   email → resetPasswordForEmail → code → verifyOtp(type:'recovery') which
 *   establishes a recovery session → new password → updateUser → signed in.
 *
 *  Requires the Supabase "Reset Password" email template to surface {{ .Token }}
 *  (the code) rather than only a link — see the design doc.
 *
 *  Rendered inside the sign-in card; `initialEmail` carries over anything already
 *  typed on the sign-in form, and `onBack` returns to the sign-in view. */
export function ForgotPasswordFlow({
  initialEmail,
  onBack,
  redirectTo,
}: {
  initialEmail: string;
  onBack: () => void;
  redirectTo: string;
}) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) return setMessage({ kind: 'error', text: 'Enter your work email first.' });
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    // Neutral response either way — don't reveal whether the account exists.
    if (error && !/rate|too many|seconds/i.test(error.message)) {
      // Only surface genuine send failures, not "user not found" style errors.
      setMessage({ kind: 'info', text: `If an account exists for ${email.trim()}, a 6-digit code is on its way.` });
      setStep('code');
      return;
    }
    if (error) return setMessage({ kind: 'error', text: error.message });
    setMessage({ kind: 'info', text: `If an account exists for ${email.trim()}, a 6-digit code is on its way.` });
    setStep('code');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) return setMessage({ kind: 'error', text: 'Enter the 6-digit code from your email.' });
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
    setBusy(false);
    if (error) {
      return setMessage({
        kind: 'error',
        text: /expired/i.test(error.message)
          ? 'That code has expired. Tap “Resend code” for a fresh one.'
          : 'That code is incorrect or expired. Check the latest email, or resend.',
      });
    }
    setMessage(null);
    setStep('password');
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    const pwIssue = passwordIssue(password);
    if (pwIssue) return setMessage({ kind: 'error', text: pwIssue });
    if (password !== confirm) return setMessage({ kind: 'error', text: 'The two passwords don’t match.' });
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setMessage({
        kind: 'error',
        text: /session|jwt|auth/i.test(error.message)
          ? 'Your reset session expired. Start again from your email.'
          : error.message,
      });
    }
    // Recovery session is now a full session — full reload so the server sees it.
    setMessage({ kind: 'info', text: 'Password updated. Taking you in…' });
    window.location.assign(redirectTo);
  }

  return (
    <div className="mt-8">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
          Reset password · Step {step === 'email' ? 1 : step === 'code' ? 2 : 3} of 3
        </p>
      </div>

      {step === 'email' && (
        <form onSubmit={sendCode} className="flex flex-col gap-[13px]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Work email</label>
            <div className={fieldClass}>
              <MailIcon />
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="you@company.com"
                className={inputClass}
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? 'Sending…' : 'Next'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyCode} className="flex flex-col gap-[13px]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              6-digit code sent to {email.trim()}
            </label>
            <div className={fieldClass}>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className={`${inputClass} tracking-[0.4em]`}
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setMessage(null);
              }}
              className="text-zinc-500 hover:underline"
            >
              ← Change email
            </button>
            <button
              type="button"
              onClick={() => sendCode()}
              disabled={busy}
              className="font-medium text-brand-600 hover:underline disabled:opacity-50"
            >
              Resend code
            </button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={setNewPassword} className="flex flex-col gap-[13px]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">New password</label>
            <div className={fieldClass}>
              <LockIcon />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                autoFocus
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="At least 8 characters"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Confirm password</label>
            <div className={fieldClass}>
              <LockIcon />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(ev) => setConfirm(ev.target.value)}
                placeholder="Re-enter password"
                className={inputClass}
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? 'Updating…' : 'Update password & sign in'}
          </button>
        </form>
      )}

      {message && (
        <p
          className={`mt-4 text-center text-[13.5px] ${
            message.kind === 'error' ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mx-auto mt-6 block text-xs text-zinc-500 hover:underline"
      >
        ← Back to sign in
      </button>
    </div>
  );
}

/* ── Icons (mirror the sign-in page set) ─────────────────────────────────────── */

function MailIcon() {
  return (
    <svg className="h-4 w-4 flex-none text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-4 w-4 flex-none text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.26M6.6 6.6A13.2 13.2 0 0 0 2 12s4 7 10 7a9.12 9.12 0 0 0 2.1-.24" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M1 1l22 22" />
    </svg>
  );
}
