/**
 * Shared facts for the legal pages (/privacy, /terms). Kept in one place so the
 * entity details, contacts and dates stay consistent.
 *
 * ⚠️ REVIEW BEFORE PUBLISHING. These pages are a solid, stack-accurate starting
 * point, NOT legal advice. Have a qualified lawyer in your operating
 * jurisdiction review them, and fill the two bracketed facts below (company
 * registration number and registered address) with the real registered details
 * — those are intentionally left blank rather than guessed.
 */
export const LEGAL = {
  /** Operator — established in-app ("by Grafaid Engineers"). */
  operator: 'Grafaid Engineers',
  product: 'DatumPro',
  /** Confirm the exact registered form (e.g. "(Private) Limited") with your papers. */
  legalEntity: 'Grafaid Engineers',
  /** Must be filled from the real company registration — not guessed. */
  registrationNumber: '[company registration number]',
  registeredAddress: '[registered business address]',
  /** Confirm these inboxes exist and are monitored. */
  privacyEmail: 'privacy@datumpro.app',
  supportEmail: 'support@datumpro.app',
  /** Primary governing law; the policy also states POPIA / GDPR-style rights. */
  governingLaw: 'Zimbabwe',
  lastUpdated: '6 August 2026',
  pricing: 'US$120 per organisation per month',
  freeTrialMonths: 3,
} as const;

/** Sub-processors the service relies on, for the Privacy Policy disclosure. */
export const SUBPROCESSORS: { name: string; purpose: string }[] = [
  { name: 'Supabase', purpose: 'Database, authentication and file storage (hosts your account and project data)' },
  { name: 'Resend', purpose: 'Transactional email (invitations, password resets, notifications)' },
  { name: 'Vercel', purpose: 'Application hosting and content delivery' },
  { name: 'Google Analytics', purpose: 'Website usage analytics — loaded only with your consent' },
  { name: 'Sentry', purpose: 'Error monitoring to detect and fix faults' },
  { name: "Africa's Talking", purpose: 'SMS one-time passcodes for mobile sign-in (mobile app only)' },
];
