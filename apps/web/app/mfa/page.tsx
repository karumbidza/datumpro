'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

type Mode = 'loading' | 'enroll' | 'verify';

/** Same-site relative ?next, else dashboard (no open redirect). */
function safeNext(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

export default function MfaPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('loading');
  const [factorId, setFactorId] = useState<string>('');
  const [qr, setQr] = useState<string>(''); // SVG data URI for enrolment
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On load, decide whether the user needs to enrol a factor or just verify one.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError(error.message);
      const totp = data?.totp?.find((f) => f.status === 'verified');
      if (totp) {
        setFactorId(totp.id);
        setMode('verify');
      } else {
        const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (enrolled.error) return setError(enrolled.error.message);
        setFactorId(enrolled.data.id);
        setQr(enrolled.data.totp.qr_code);
        setMode('enroll');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      return setError(challenge.error.message);
    }
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verify.error) return setError(verify.error.message);
    window.location.assign(safeNext()); // reload so the server sees AAL2
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {mode === 'enroll'
            ? 'Your organization requires 2FA. Scan this code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code.'
            : 'Enter the 6-digit code from your authenticator app to continue.'}
        </p>

        {mode === 'loading' && <p className="mt-6 text-sm text-zinc-500">Preparing…</p>}

        {mode === 'enroll' && qr && (
          // Supabase returns the QR as an SVG data URI.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Authenticator QR code" className="mx-auto mt-4 h-44 w-44" />
        )}

        {(mode === 'enroll' || mode === 'verify') && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={inputClass}
            />
            <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
              {busy ? 'Verifying…' : mode === 'enroll' ? 'Enable 2FA' : 'Verify'}
            </Button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </Card>
    </main>
  );
}
