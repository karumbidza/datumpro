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
