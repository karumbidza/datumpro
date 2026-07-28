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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="DatumPro" className="mb-7 h-11 w-11 rounded-xl shadow-sm" />
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

          {/* What you get */}
          <ul className="mt-7 space-y-2.5">
            <li className="flex items-center gap-2.5 text-[13px] text-zinc-600 dark:text-zinc-400">
              <FeatureClock />
              Track every task’s progress and SLA
            </li>
            <li className="flex items-center gap-2.5 text-[13px] text-zinc-600 dark:text-zinc-400">
              <FeatureBids />
              Compare sealed bids before you award
            </li>
            <li className="flex items-center gap-2.5 text-[13px] text-zinc-600 dark:text-zinc-400">
              <FeatureProof />
              Release payment only on verified proof
            </li>
          </ul>
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

      {/* ── Poster column (50%, hidden < lg) — geometric, Keyhub-style ──────── */}
      <div className="relative hidden min-w-0 flex-1 flex-col justify-center overflow-hidden bg-brand-600 px-14 lg:flex">
        <PosterDecor />
        <h2 className="relative z-10 max-w-[420px] font-display text-[38px] font-bold leading-[1.14] tracking-[-0.02em] text-white [text-wrap:balance]">
          Every task priced, tracked and paid — in one place.
        </h2>
        <p className="relative z-10 mt-5 max-w-[400px] text-[15px] leading-[1.6] text-white/[.8]">
          DatumPro helps construction and project teams tender work, compare sealed bids, track progress against the
          plan, and release payment when the proof is in.
        </p>
      </div>
    </main>
  );
}

/* ── Poster decoration — geometric "pixel confetti" (Keyhub-style) ─────────── */

function Sq({ c, s, className = '', rot = 0, r = 4 }: { c: string; s: number; className?: string; rot?: number; r?: number }) {
  return (
    <div className={`absolute ${className}`} style={{ width: s, height: s, background: c, borderRadius: r, transform: `rotate(${rot}deg)` }} />
  );
}

function Plus({ c, s, className = '', rot = 0 }: { c: string; s: number; className?: string; rot?: number }) {
  return (
    <svg className={`absolute ${className}`} width={s} height={s} viewBox="0 0 24 24" fill={c} style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
    </svg>
  );
}

function Spark({ c, s, className = '' }: { c: string; s: number; className?: string }) {
  return (
    <svg className={`absolute ${className}`} width={s} height={s} viewBox="0 0 24 24" fill={c} aria-hidden="true">
      <path d="M12 0c1 6 5 10 12 12-7 2-11 6-12 12-1-6-5-10-12-12 7-2 11-6 12-12z" />
    </svg>
  );
}

function Tri({ c, s, className = '', rot = 0 }: { c: string; s: number; className?: string; rot?: number }) {
  return (
    <svg className={`absolute ${className}`} width={s} height={s} viewBox="0 0 24 24" fill={c} style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <path d="M12 4l9 16H3z" />
    </svg>
  );
}

/** Scattered geometric shapes layered behind the poster headline. */
function PosterDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* faint large squares */}
      <div className="absolute right-16 top-16 h-44 w-44 rounded bg-white/[.05]" />
      <div className="absolute -left-12 bottom-12 h-40 w-40 rounded bg-white/[.04]" />

      {/* cyan cluster, top-left */}
      <Sq c="#22d3ee" s={24} className="left-10 top-24" />
      <Sq c="#38bdf8" s={24} className="left-10 top-[124px]" />
      <Sq c="#38bdf8" s={24} className="left-[64px] top-24" />

      {/* pixel plus signs */}
      <Plus c="#7dd3fc" s={32} className="right-24 top-16" />
      <Plus c="#bfdbfe" s={42} className="right-16 bottom-28" rot={12} />
      <Plus c="#3b82f6" s={22} className="left-1/2 top-10" />
      <Plus c="#60a5fa" s={26} className="left-16 bottom-1/3" rot={-8} />

      {/* solid squares */}
      <Sq c="#1e40af" s={30} className="right-12 top-1/3" rot={12} />
      <Sq c="#93c5fd" s={20} className="right-1/3 bottom-16" rot={8} />
      <Sq c="#22d3ee" s={16} className="right-28 top-1/2" rot={20} />

      {/* sparkles */}
      <Spark c="rgba(255,255,255,.92)" s={26} className="left-20 bottom-[24%]" />
      <Spark c="#a5f3fc" s={18} className="right-24 top-[22%]" />

      {/* pencil pill + triangle */}
      <div className="absolute left-24 top-32 h-2.5 w-14 rotate-45 rounded-full bg-white/90" />
      <Tri c="#2563eb" s={22} className="bottom-20 left-1/3" rot={-15} />

      {/* dots */}
      <div className="absolute left-1/3 top-20 h-2.5 w-2.5 rounded-full bg-blue-300/80" />
      <div className="absolute right-1/4 bottom-1/4 h-2 w-2 rounded-full bg-cyan-300/80" />
    </div>
  );
}

/* ── Feature-bullet icons ──────────────────────────────────────────────────── */

function FeatureClock() {
  return (
    <svg className="h-4 w-4 flex-none text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function FeatureBids() {
  return (
    <svg className="h-4 w-4 flex-none text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

function FeatureProof() {
  return (
    <svg className="h-4 w-4 flex-none text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
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
