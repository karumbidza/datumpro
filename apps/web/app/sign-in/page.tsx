'use client';

import { use, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

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
  // it's identical on server and client (no hydration mismatch) — the invitee
  // signs in or creates their account with the exact invited address.
  const invited = (use(searchParams).email ?? '').trim();
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState(invited);
  const fromInvite = invited !== '';
  const [password, setPassword] = useState('');
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
            ? 'We couldn’t sign you in. New here? Tap “Create account” below to set your password. If you just created it, check your email for a confirmation link first.'
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
      text: 'Account created! Check your email for a confirmation link to finish — then you’ll be signed in and returned here to accept.',
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

  // OAuth providers return a verified email, so there's no separate confirmation
  // step — the browser redirects to the provider, then back to /auth/callback.
  async function oauth(provider: 'google' | 'linkedin_oidc') {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext())}`,
        // Nudge the provider to the invited address when we know it.
        ...(fromInvite && provider === 'google' ? { queryParams: { login_hint: email } } : {}),
      },
    });
    if (error) {
      setBusy(false);
      setMessage({ kind: 'error', text: error.message });
    }
    // On success the browser navigates away to the provider — nothing more to do.
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="DatumPro"
        className="mx-auto mb-6 h-20 w-20 rounded-2xl shadow-sm"
      />
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">
          {fromInvite ? 'Accept your invitation' : 'Sign in to DatumPro'}
        </h1>

        {fromInvite && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Sign in with <span className="font-medium">{email}</span> — or, if you’re new, tap{' '}
            <span className="font-medium">Create account</span> to set a password. Then you’ll return
            to accept the invite.
          </p>
        )}

        {/* Third-party sign-in — a verified email straight from the provider. */}
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => oauth('google')}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => oauth('linkedin_oidc')}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <LinkedInIcon />
            Continue with LinkedIn
          </button>
        </div>

        <div className="my-4 flex items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          or with email
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        <div className="flex gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
          <button
            onClick={() => setMethod('password')}
            className={`flex-1 rounded px-3 py-1.5 ${method === 'password' ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500'}`}
          >
            Password
          </button>
          <button
            onClick={() => setMethod('magiclink')}
            className={`flex-1 rounded px-3 py-1.5 ${method === 'magiclink' ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500'}`}
          >
            Magic link
          </button>
        </div>

        {method === 'password' ? (
          <form onSubmit={passwordSignIn} className="mt-5 space-y-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} />
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputClass} />
            {fromInvite ? (
              // Invited people are usually new — lead with Create account.
              <div className="space-y-2">
                <Button type="button" className="w-full" onClick={signUp} disabled={busy}>
                  {busy ? 'Creating…' : 'Create account'}
                </Button>
                <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
                  {busy ? '…' : 'I already have an account'}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={busy}>{busy ? '…' : 'Sign in'}</Button>
                <Button type="button" variant="secondary" onClick={signUp} disabled={busy}>Create account</Button>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={magicLink} className="mt-5 space-y-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} />
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a magic link'}</Button>
          </form>
        )}

        {message && (
          <p className={`mt-4 text-sm ${message.kind === 'error' ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
            {message.text}
          </p>
        )}
      </Card>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
