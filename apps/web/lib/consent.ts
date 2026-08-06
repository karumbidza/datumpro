/**
 * Cookie-consent state (client-side). Analytics is opt-in: Google Analytics is
 * not loaded until the visitor explicitly accepts, which is the GDPR requirement
 * and the safe default under POPIA / Zimbabwe's Cyber and Data Protection Act.
 *
 * Client-only — reads `document.cookie`. Do not import from server code.
 */
export const CONSENT_COOKIE = 'dp_cookie_consent';
/** Fired on window when the choice changes, so the analytics gate re-evaluates. */
export const CONSENT_CHANGED_EVENT = 'dp-consent-changed';
/** Fired on window to re-open the banner (e.g. a "Manage cookies" footer link). */
export const CONSENT_OPEN_EVENT = 'dp-consent-open';

export type ConsentValue = 'granted' | 'denied';

/** Roughly six months — long enough not to nag, short enough to re-ask. */
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

export function readConsent(): ConsentValue | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)dp_cookie_consent=([^;]+)/);
  if (!match?.[1]) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'granted' || value === 'denied' ? value : null;
}

export function writeConsent(value: ConsentValue): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

export function openConsentBanner(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}
