/**
 * Work-email check for org creation — used to render a NON-blocking nudge on the
 * setup screen (not a gate). We keep the block conservative — only the most
 * common free/consumer providers — because many legitimate SMEs (especially
 * construction firms in the target market) run on a small provider domain, and
 * org creation must never be refused. Invited members are never checked (they
 * arrive via an invitation, not org creation), so field contractors on personal
 * email are unaffected. Tune PERSONAL_EMAIL_DOMAINS as needed.
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
  'mail.com',
]);

/** True when `email` looks like a real company address (not a free provider). */
export function isBusinessEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return false;
  const domain = normalized.slice(at + 1);
  return !PERSONAL_EMAIL_DOMAINS.has(domain);
}
