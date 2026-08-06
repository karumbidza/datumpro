'use client';

import { openConsentBanner } from '@/lib/consent';

/** Footer affordance to re-open the cookie banner and change the analytics choice. */
export function ManageCookiesLink({ className = '' }: { className?: string }) {
  return (
    <button type="button" onClick={openConsentBanner} className={className}>
      Manage cookies
    </button>
  );
}
