'use client';

import { use, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';

const fieldClass =
  'flex h-11 w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-[13px] text-sm text-zinc-900 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100';
const inputClass = 'flex-1 bg-transparent outline-none placeholder:text-zinc-400';

type Method = 'password' | 'magiclink';

/** Post-auth destination from ?next=, restricted to same-site relative paths so
 *  it can't be turned into an open redirect. Defaults to the dashboard. */
function safeNext(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  // Email carried over from an invite link (?email=), read from searchParams so
  // it's identical on server and client (no hydration mismatch).
  const invited = (use(searchParams).email ?? '').trim();
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState(invited);
  const fromInvite = invited !== '';
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function passwordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      const needsSignup = /invalid login credentials|email not confirmed/i.test(error.message);
      return setMessage({
        kind: 'error',
        text: needsSignup
          ? fromInvite
            ? 'We couldn’t sign you in. New here? Tap “Create account” to set your password. If you just created it, check your email for a confirmation link first.'
            : 'We couldn’t sign you in. Check your password, or if you’re new, tap “Create account”. If you just signed up, confirm via the link in your email first.'
          : error.message,
      });
    }
    window.location.assign(safeNext()); // full reload so the server picks up the session
  }

  async function signUp() {
    if (!email.trim() || password.length < 6) {
      return setMessage({ kind: 'error', text: 'Enter an email and a password of at least 6 characters.' });
    }
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext())}` },
    });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });
    if (data.session) return window.location.assign(safeNext()); // confirmation disabled → straight in
    setMessage({
      kind: 'info',
      text: 'Account created! Check your email for a confirmation link to finish — then you’ll be signed in and returned here.',
    });
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext())}` },
    });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });
    setMessage({ kind: 'info', text: `Magic link sent to ${email}. Open it in this browser.` });
  }

  // Password reset — emails a recovery link that lands on /reset-password (via the
  // auth callback, which establishes the recovery session).
  async function forgotPassword() {
    if (!email.trim()) {
      return setMessage({ kind: 'error', text: 'Enter your work email above first, then tap “Forgot?”.' });
    }
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
    });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });
    setMessage({ kind: 'info', text: `Password reset link sent to ${email}. Open it to choose a new password.` });
  }

  // OAuth (Google) returns a verified email — no separate confirmation step.
  async function oauth(provider: 'google') {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext())}`,
        ...(fromInvite ? { queryParams: { login_hint: email } } : {}),
      },
    });
    if (error) {
      setBusy(false);
      setMessage({ kind: 'error', text: error.message });
    }
  }

  return (
    <main className="flex min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Form column (50%) ───────────────────────────────────────────────── */}
      <div className="flex w-full flex-col px-6 py-10 sm:px-[52px] sm:py-11 lg:w-1/2 lg:flex-none">
        <div className="mx-auto my-auto w-full max-w-[400px] py-8">
          <h1 className="font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-zinc-900 dark:text-white">
            {fromInvite ? 'Accept your invitation' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {fromInvite ? (
              <>
                Sign in with <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span> — or tap{' '}
                <span className="font-medium">Create account</span> to set a password. Then you’ll return to accept.
              </>
            ) : (
              'Sign in to run your projects, tasks and payments.'
            )}
          </p>

          {/* OAuth */}
          <div className="mt-[26px]">
            <button
              type="button"
              onClick={() => oauth('google')}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-[9px] rounded-lg border border-zinc-200 bg-white text-sm font-semibold text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </div>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or with email
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>

          {/* Method tabs */}
          <div className="flex gap-1 rounded-[9px] bg-zinc-100 p-1 dark:bg-zinc-900">
            {(['password', 'magiclink'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m);
                  setMessage(null);
                }}
                className={`flex-1 rounded-md py-2 text-[13.5px] font-semibold transition ${
                  method === m
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {m === 'password' ? 'Password' : 'Magic link'}
              </button>
            ))}
          </div>

          {method === 'password' ? (
            <form onSubmit={passwordSignIn} className="mt-[18px] flex flex-col gap-[13px]">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Work email</label>
                <div className={fieldClass}>
                  <MailIcon />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Password</label>
                  <button
                    type="button"
                    onClick={forgotPassword}
                    disabled={busy}
                    className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                  >
                    Forgot?
                  </button>
                </div>
                <div className={fieldClass}>
                  <LockIcon />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
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

              <div className="mt-1 flex gap-2.5">
                {fromInvite ? (
                  <>
                    <button
                      type="button"
                      onClick={signUp}
                      disabled={busy}
                      className="h-[46px] flex-1 rounded-lg bg-brand-500 text-[14.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                    >
                      {busy ? 'Creating…' : 'Create account'}
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-[46px] rounded-lg border border-zinc-200 bg-white px-[18px] text-[14.5px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      {busy ? '…' : 'I have an account'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-[46px] flex-1 rounded-lg bg-brand-500 text-[14.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                    >
                      {busy ? '…' : 'Sign in'}
                    </button>
                    <button
                      type="button"
                      onClick={signUp}
                      disabled={busy}
                      className="h-[46px] rounded-lg border border-zinc-200 bg-white px-[18px] text-[14.5px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Create account
                    </button>
                  </>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={magicLink} className="mt-[18px] flex flex-col gap-[13px]">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Work email</label>
                <div className={fieldClass}>
                  <MailIcon />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputClass}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="h-[46px] w-full rounded-lg bg-brand-500 text-[14.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Email me a magic link'}
              </button>
            </form>
          )}

          {message && (
            <p
              className={`mt-4 text-[13.5px] ${
                message.kind === 'error' ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>

        {/* Legal + enterprise entry point (pinned to column bottom) */}
        <div className="mx-auto w-full max-w-[400px] text-xs text-zinc-400">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              © 2026 DatumPro ·{' '}
              <a href="/security" className="text-zinc-500 hover:underline">
                Terms
              </a>{' '}
              ·{' '}
              <a href="/security" className="text-zinc-500 hover:underline">
                Privacy
              </a>
            </span>
            <a href="/enterprise" className="text-zinc-500 hover:text-brand-600 hover:underline">
              For government &amp; enterprise →
            </a>
          </div>
        </div>
      </div>

      {/* ── Poster column (50%, hidden < lg) ───────────────────────────────── */}
      <div className="relative hidden min-w-0 flex-1 flex-col overflow-hidden bg-brand-600 p-12 lg:flex">
        {/* Decorative rings, top-right */}
        <div className="pointer-events-none absolute -right-[80px] -top-[80px] h-[300px] w-[300px] rounded-full border border-white/[.12]" />
        <div className="pointer-events-none absolute -right-[30px] -top-[30px] h-[200px] w-[200px] rounded-full border border-white/[.09]" />
        {/* Blended logo — extreme top-right corner */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-[-26px] top-[-32px] h-[200px] w-[172px] object-contain opacity-80 [mix-blend-mode:soft-light]"
        />

        <h2 className="relative max-w-[460px] font-display text-[29px] font-semibold leading-[1.2] tracking-[-0.02em] text-white [text-wrap:balance]">
          Every task priced, tracked and paid — in one place.
        </h2>
        <p className="mt-3 max-w-[440px] text-[14px] leading-[1.55] text-white/[.78]">
          Tender work out, compare sealed bids, watch progress against the plan, and release payment when the proof
          is in.
        </p>

        {/* Single task snapshot, centered with breathing room */}
        <div className="relative flex flex-1 items-center py-8">
          <TaskSnapshotCard />
        </div>

        {/* Trust statements */}
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2">
          {['Transparent by design', 'Secure & role-based', 'Real progress tracking'].map((t) => (
            <span key={t} className="flex items-center gap-2 text-[13px] text-white/[.92]">
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#93c5fd]" />
              {t}
            </span>
          ))}
          <span className="flex items-center gap-2 text-[13px] text-white/[.92]">
            <PhoneIcon />
            Available on mobile — iOS &amp; Android
          </span>
        </div>
      </div>
    </main>
  );
}

/* ── Task snapshot card (static sample; mirrors the real task plan) ────────── */

function TaskSnapshotCard() {
  const steps = [
    { title: 'Excavate footing', cost: '$1,800', done: true },
    { title: 'Pour & cure concrete', cost: '$4,250', done: true },
    { title: 'Strike formwork', cost: '$560', done: false },
  ];
  return (
    <div className="w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(8,20,60,.32)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-zinc-900">Ground floor slab</div>
          <div className="mt-0.5 text-xs text-zinc-500">Riverside Depot · Task plan</div>
        </div>
        <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700">
          On track
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
        <span className="text-[13px] text-zinc-600">Awarded value</span>
        <span className="text-base font-bold tabular-nums text-brand-800">$6,610.00</span>
      </div>

      <div className="mt-5 flex items-center justify-between text-[13px]">
        <span className="text-zinc-500">Progress</span>
        <span className="font-semibold tabular-nums text-zinc-900">2 of 3 done · 66%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full bg-green-500" style={{ width: '66%' }} />
      </div>

      <div className="mt-5 flex flex-col gap-3.5">
        {steps.map((s) => (
          <div key={s.title} className="flex items-center gap-3">
            {s.done ? (
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-green-500 text-[11px] text-white">
                ✓
              </span>
            ) : (
              <span className="h-5 w-5 flex-none rounded-full border-2 border-zinc-300" />
            )}
            <span className={`flex-1 text-sm ${s.done ? 'text-zinc-400 line-through' : 'font-medium text-zinc-900'}`}>
              {s.title}
            </span>
            <span className="text-[13px] tabular-nums text-zinc-400">{s.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */

function GoogleIcon() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

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

function PhoneIcon() {
  return (
    <svg className="h-[13px] w-[13px] flex-none" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}
