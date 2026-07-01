/**
 * Minimal, dependency-free error reporting. When a Sentry DSN is configured it
 * posts a compact event to Sentry's store endpoint; otherwise it logs. Isomorphic
 * (server + client) and never throws — reporting must not create new failures.
 *
 * The DSN public key is safe to expose to the browser (that is how Sentry's own
 * browser SDK works), so NEXT_PUBLIC_SENTRY_DSN is used on the client.
 */
type Ctx = Record<string, unknown>;

function getDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function parseDsn(dsn: string): { key: string; host: string; projectId: string } | null {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn.trim());
  if (!m) return null;
  return { key: m[1]!, host: m[2]!, projectId: m[3]! };
}

export async function captureException(error: unknown, context?: Ctx): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const dsn = getDsn();
  if (!dsn) {
    console.error('[observe]', err.message, context ?? '');
    return;
  }
  const p = parseDsn(dsn);
  if (!p) {
    console.error('[observe] invalid SENTRY_DSN; falling back to log:', err.message);
    return;
  }
  try {
    const eventId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`).replace(
      /-/g,
      '',
    );
    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: typeof window === 'undefined' ? 'node' : 'javascript',
      level: 'error',
      environment: process.env.NODE_ENV,
      exception: { values: [{ type: err.name, value: err.message }] },
      extra: { ...context, stack: err.stack },
    };
    await fetch(`https://${p.host}/api/${p.projectId}/store/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${p.key}, sentry_client=datumpro/1.0`,
      },
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch {
    // swallow — the reporter must never throw
  }
}
