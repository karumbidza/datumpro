/** Next.js instrumentation. `register()` runs once when a server instance boots;
 *  we use it to validate the environment fail-fast (a missing required secret
 *  crashes startup with a clear message instead of surfacing as a confusing error
 *  deep in a later request). `onRequestError` forwards server errors to Sentry. */
export async function register(): Promise<void> {
  // Only in the Node runtime (Edge has no server secrets), and never during the
  // build phase — build runs with placeholder env and must not fail the required
  // checks that only apply to a live server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // Public NEXT_PUBLIC_* vars (throws on its top-level parse if any are missing).
  await import('@/lib/env');
  // Server-only secrets.
  const { validateServerEnv } = await import('@/lib/env.server');
  validateServerEnv();
}

/** Next.js instrumentation — forwards server-side request errors to our reporter.
 *  Runs in the Node/edge runtime; the reporter no-ops without a SENTRY_DSN. */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  const { captureException } = await import('@/lib/observability/sentry');
  await captureException(error, {
    path: request?.path,
    method: request?.method,
    routePath: context?.routePath,
    routeType: context?.routeType,
  });
}
