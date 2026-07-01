/** Shared guard for cron routes. Vercel Cron sends `Authorization: Bearer
 *  $CRON_SECRET` when the env var is set. We refuse to run when it's unset so the
 *  endpoint is never left open. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
