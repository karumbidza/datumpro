'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

type Method = 'password' | 'magiclink';

export default function SignInPage() {
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
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
    if (error) return setMessage({ kind: 'error', text: error.message });
    window.location.assign('/dashboard'); // full reload so the server picks up the session
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
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/dashboard` },
    });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });
    if (data.session) return window.location.assign('/dashboard'); // confirmation disabled → straight in
    setMessage({ kind: 'info', text: 'Account created. Check your email to confirm, then sign in.' });
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/dashboard` },
    });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });
    setMessage({ kind: 'info', text: `Magic link sent to ${email}. Open it in this browser.` });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">Sign in to DatumPro</h1>

        <div className="mt-4 flex gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
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
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={busy}>{busy ? '…' : 'Sign in'}</Button>
              <Button type="button" variant="secondary" onClick={signUp} disabled={busy}>Create account</Button>
            </div>
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
