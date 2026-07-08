import { timingSafeEqual } from 'node:crypto';

/**
 * Guard for the cross-product admin adapter (`/api/admin/*`).
 *
 * Mission Control (the external command center) calls these routes with
 * `Authorization: Bearer $ADMIN_ADAPTER_SECRET`. Like the cron guard, we refuse
 * to run when the secret is unset so the adapter is never left open. The routes
 * behind this guard use the service-role client (RLS-bypassing), so this check is
 * the only thing standing between the caller and every org's data — keep it strict.
 */
export function adapterAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_ADAPTER_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
