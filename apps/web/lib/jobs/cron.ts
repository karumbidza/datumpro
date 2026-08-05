import { timingSafeEqual } from 'node:crypto';

/** Shared guard for cron routes. Vercel Cron sends `Authorization: Bearer
 *  $CRON_SECRET` when the env var is set. We refuse to run when it's unset so the
 *  endpoint is never left open. Constant-time comparison (matches the admin
 *  adapter guard) so the secret can't be recovered by timing. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
