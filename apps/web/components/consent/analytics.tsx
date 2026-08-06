'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { CONSENT_CHANGED_EVENT, readConsent } from '@/lib/consent';

/**
 * Consent-gated Google Analytics. The GA scripts are injected only after the
 * visitor has accepted analytics cookies (readConsent() === 'granted'), and the
 * gate re-evaluates live when the choice changes — so accepting the banner starts
 * analytics without a page reload, and declining ships zero GA scripts.
 *
 * `gaId` is passed from the server layout (NEXT_PUBLIC_GA_ID); no id → nothing.
 */
export function ConsentAnalytics({ gaId }: { gaId?: string }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const sync = () => setGranted(readConsent() === 'granted');
    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
  }, []);

  if (!gaId || !granted) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`}
      </Script>
    </>
  );
}
