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
  /** Owning/operating company (the entity you contract with). */
  operator: 'Quillstone Capital Private Limited',
  product: 'DatumPro',
  legalEntity: 'Quillstone Capital Private Limited',
  /** The division that builds/operates the product — used as the brand credit. */
  department: 'Quillstone Digital',
  /** Still to fill from the company registration papers — not guessed. */
  registrationNumber: '[company registration number]',
  registeredAddress: '275 Henderson Road, Hatfield, Harare, Zimbabwe',
  /** Confirm this inbox is monitored for privacy/support enquiries. */
  privacyEmail: 'allenk@quillstonecapital.com',
  supportEmail: 'allenk@quillstonecapital.com',
  phone: '+263 77 618 3229',
  /** Primary governing law; the policy also states POPIA / GDPR-style rights. */
  governingLaw: 'Zimbabwe',
  /** Applies to the Privacy Policy. Terms carry their own date (termsUpdated). */
  lastUpdated: '6 August 2026',
  termsUpdated: '3 September 2026',
  /** Onboarding is managed and pricing is bespoke — set per organisation in a
   *  written Subscription Order, not a public list price. */
  pricing: 'custom pricing agreed per organisation',
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
