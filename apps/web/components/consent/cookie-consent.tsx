'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CONSENT_OPEN_EVENT, readConsent, writeConsent } from '@/lib/consent';

/**
 * Bottom cookie-consent banner. Shows on first visit (no stored choice) and can
 * be re-opened via the CONSENT_OPEN_EVENT ("Manage cookies"). Choosing writes the
 * cookie and dispatches the change event so the analytics gate reacts without a
 * reload. Analytics stays off until "Accept".
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!readConsent()) setVisible(true);
    const open = () => setVisible(true);
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  if (!visible) return null;

  const choose = (value: 'granted' | 'denied') => {
    writeConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          We use essential cookies to run DatumPro, and — only with your consent — analytics cookies
          to understand how the site is used. See our{' '}
          <Link href="/privacy#cookies" className="underline">
            Cookie &amp; Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => choose('denied')}>
            Decline
          </Button>
          <Button variant="primary" size="sm" onClick={() => choose('granted')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
