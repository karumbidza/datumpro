'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CONSENT_OPEN_EVENT, readConsent, writeConsent } from '@/lib/consent';

/**
 * Centered cookie-consent modal (dimmed backdrop). Shows on first visit (no
 * stored choice) and can be re-opened via CONSENT_OPEN_EVENT ("Manage cookies").
 * Choosing writes the cookie and dispatches the change event so the analytics
 * gate reacts without a reload — analytics stays off until "Accept all".
 *
 * First visit forces a decision (no dismiss). When re-opened for a returning
 * visitor who already has a stored choice, Escape / backdrop close it.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  // Whether a prior choice already exists — controls whether the modal is
  // dismissable without picking again.
  const [dismissable, setDismissable] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!readConsent()) setVisible(true);
    const open = () => {
      setDismissable(readConsent() !== null);
      setVisible(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  const close = useCallback(() => {
    if (dismissable) setVisible(false);
  }, [dismissable]);

  // Focus the primary action on open; allow Escape to dismiss when permitted.
  useEffect(() => {
    if (!visible) return;
    acceptRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, close]);

  if (!visible) return null;

  const choose = (value: 'granted' | 'denied') => {
    writeConsent(value);
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-consent-title"
    >
      {/* Dimmed backdrop */}
      <button
        type="button"
        aria-label={dismissable ? 'Close' : undefined}
        tabIndex={dismissable ? 0 : -1}
        onClick={close}
        className={`absolute inset-0 bg-zinc-950/50 backdrop-blur-sm ${dismissable ? 'cursor-pointer' : 'cursor-default'}`}
      />

      {/* Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            <CookieIcon />
          </div>
          {dismissable && (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <h2
          id="cookie-consent-title"
          className="font-display text-lg font-semibold tracking-tight text-zinc-900 dark:text-white"
        >
          Privacy &amp; cookie settings
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          We use <span className="font-medium text-zinc-800 dark:text-zinc-200">essential cookies</span> to run
          DatumPro securely. With your consent we also use{' '}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">analytics cookies</span> to understand
          how the site is used and improve it. You can change or withdraw your choice at any time.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Link href="/privacy" className="text-zinc-500 underline hover:text-brand-600 dark:text-zinc-400">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-zinc-500 underline hover:text-brand-600 dark:text-zinc-400">
            Terms
          </Link>
          <Link
            href="/privacy#cookies"
            className="text-zinc-500 underline hover:text-brand-600 dark:text-zinc-400"
          >
            More details
          </Link>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => choose('denied')} className="flex-1">
            Deny
          </Button>
          <Button ref={acceptRef} variant="primary" onClick={() => choose('granted')} className="flex-1">
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}

function CookieIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z" />
      <circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
