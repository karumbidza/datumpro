import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Signed, stateless unsubscribe tokens for the weekly digest email. The payload
 *  is just (userId, orgId); an HMAC over it (keyed by CRON_SECRET) makes the link
 *  unforgeable, so the one-click unsubscribe route needs no session. */

function secret(): string | null {
  return process.env.CRON_SECRET || null;
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function unb64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** Returns a token, or null when no secret is configured (link is then omitted). */
export function weeklyUnsubToken(userId: string, orgId: string): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `${userId}:${orgId}`;
  const sig = createHmac('sha256', key).update(payload).digest('base64url');
  return `${b64url(payload)}.${sig}`;
}

export function verifyWeeklyUnsubToken(token: string): { userId: string; orgId: string } | null {
  const key = secret();
  if (!key) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let payload: string;
  try {
    payload = unb64url(body);
  } catch {
    return null;
  }
  const expected = createHmac('sha256', key).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, orgId] = payload.split(':');
  if (!userId || !orgId) return null;
  return { userId, orgId };
}
