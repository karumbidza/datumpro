'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { passwordIssue } from '@datumpro/shared/validation';

const fieldClass =
  'flex h-11 w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100';

/** Completes the password-reset flow. The recovery link lands here (via
 *  /auth/callback, which established a recovery session), and the user sets a new
 *  password with supabase.auth.updateUser. */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwIssue = passwordIssue(password);
    if (pwIssue) return setMessage({ kind: 'error', text: pwIssue });
    if (password !== confirm) return setMessage({ kind: 'error', text: 'The two passwords don’t match.' });
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      return setMessage({
        kind: 'error',
        text: /session|jwt|auth/i.test(error.message)
          ? 'This reset link has expired or was already used. Request a new one from the sign-in page.'
          : error.message,
      });
    }
    setDone(true);
    setMessage({ kind: 'info', text: 'Password updated. Taking you to your dashboard…' });
    setTimeout(() => window.location.assign('/dashboard'), 1200);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-2xl font-semibold leading-[1.2] tracking-[-0.02em] text-zinc-900 dark:text-white">
        Choose a new password
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Set a new password for your DatumPro account.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">New password</label>
          <div className={fieldClass}>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="flex-1 bg-transparent outline-none placeholder:text-zinc-400"
              disabled={busy || done}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Confirm password</label>
          <div className={fieldClass}>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="flex-1 bg-transparent outline-none placeholder:text-zinc-400"
              disabled={busy || done}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy || done}
          className="mt-1 h-11 w-full rounded-lg bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>

      {message && (
        <p className={`mt-4 text-sm ${message.kind === 'error' ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
          {message.text}
        </p>
      )}

      <a href="/sign-in" className="mt-6 text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
        ← Back to sign in
      </a>
    </main>
  );
}
