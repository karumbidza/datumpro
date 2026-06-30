'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** Email magic-link sign-in. SMS OTP (Africa's Talking) is added as a second
 *  method in a later slice; the flow here stays provider-agnostic at the UI. */
export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/dashboard` },
    });
    setStatus(error ? 'error' : 'sent');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">Sign in to DatumPro</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          We&apos;ll email you a secure sign-in link.
        </p>

        {status === 'sent' ? (
          <p className="mt-6 text-sm text-zinc-700 dark:text-zinc-300">
            Check <span className="font-medium">{email}</span> for your sign-in link.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800"
            />
            <Button type="submit" className="w-full" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </Button>
            {status === 'error' && (
              <p className="text-sm text-red-500">Couldn&apos;t send the link. Try again.</p>
            )}
          </form>
        )}
      </Card>
    </main>
  );
}
