'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { passwordIssue } from '@datumpro/shared/validation';
import { Button } from '@/components/ui/button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Change-password form for a signed-in user. We re-verify the CURRENT password
 *  (via signInWithPassword) before updating — Supabase's updateUser doesn't check
 *  it, so without this an unlocked/hijacked session could reset the password with
 *  no knowledge of the old one. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwIssue = passwordIssue(next);
    if (pwIssue) return setMessage({ kind: 'error', text: pwIssue });
    if (next !== confirm) return setMessage({ kind: 'error', text: 'The two new passwords don’t match.' });
    if (next === current) return setMessage({ kind: 'error', text: 'Choose a password different from your current one.' });

    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    // 1. Prove the caller knows the current password.
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current });
    if (reauthError) {
      setBusy(false);
      return setMessage({ kind: 'error', text: 'Your current password is incorrect.' });
    }

    // 2. Apply the new password.
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: error.message });

    setCurrent('');
    setNext('');
    setConfirm('');
    setMessage({ kind: 'info', text: 'Password updated.' });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium">Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">New password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Updating…' : 'Update password'}
      </Button>
      {message && (
        <p className={`text-[13px] ${message.kind === 'error' ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
