import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment secrets, validated once at boot (see
 * instrumentation.ts → register()). Complements lib/env.ts, which validates the
 * public NEXT_PUBLIC_* vars.
 *
 * `import 'server-only'` makes the bundler throw if this module is ever pulled
 * into client code, so a secret can never leak into the browser bundle.
 *
 * The schema itself is deliberately lenient (optional strings) so a slightly-off
 * value never crashes the process on import. All the opinionated required /
 * recommended / shape rules live in validateServerEnv(), which runs at server
 * startup and fails fast with an aggregated, actionable message.
 */
const serverSchema = z.object({
  // Service-role key for RLS-bypassing server jobs (cron scans, fan-outs, the
  // admin adapter). Without it those paths throw at call time.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Bearer secret for the Mission Control admin adapter (/api/admin/*) and the
  // support bridge. Guards fail closed when unset.
  ADMIN_ADAPTER_SECRET: z.string().optional(),
  // Bearer secret Vercel Cron presents; the cron guard refuses to run when unset.
  CRON_SECRET: z.string().optional(),
  // Upstream "Pulse" command-centre base URL used by the support bridge.
  PULSE_URL: z.string().optional(),
  // Transactional email (Resend).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  // Where enterprise-request notifications are sent (optional).
  ENTERPRISE_REQUEST_NOTIFY_EMAIL: z.string().optional(),
  // Error reporting sink (optional; reporter no-ops without it).
  SENTRY_DSN: z.string().optional(),
  // Out-of-band sink for dropped audit writes (optional).
  AUDIT_ALERT_WEBHOOK: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

const parsed = serverSchema.safeParse(process.env);
export const serverEnv: ServerEnv = parsed.success ? parsed.data : {};

const isProd = () => process.env.NODE_ENV === 'production';
const val = (k: keyof ServerEnv): string => (process.env[k] ?? '').trim();

/**
 * Assert the server environment at boot. Throws (crashing startup) only when a
 * hard requirement is missing in production; everything else is surfaced as a
 * console warning so a legitimate minimal deployment still boots.
 */
export function validateServerEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Hard requirements (production only; dev/test/CI may omit them) ──────────
  if (isProd() && !val('SUPABASE_SERVICE_ROLE_KEY')) {
    errors.push(
      'SUPABASE_SERVICE_ROLE_KEY is required in production — server jobs (cron scans, fan-outs, the admin adapter) use the RLS-bypassing service-role client.',
    );
  }

  // ── Shape checks — warn (never crash) when a present value looks wrong ──────
  for (const k of ['PULSE_URL', 'SENTRY_DSN', 'AUDIT_ALERT_WEBHOOK'] as const) {
    const v = val(k);
    if (v) {
      try {
        new URL(v);
      } catch {
        warnings.push(`${k} is set but is not a valid URL — the dependent feature will be skipped.`);
      }
    }
  }
  for (const k of ['ADMIN_ADAPTER_SECRET', 'CRON_SECRET'] as const) {
    const v = val(k);
    if (v && v.length < 16) {
      warnings.push(`${k} is set but is short (< 16 chars); use a long random secret.`);
    }
  }
  // Resend needs both halves to send; flag a half-configured setup.
  if (Boolean(val('RESEND_API_KEY')) !== Boolean(val('RESEND_FROM_EMAIL'))) {
    warnings.push('RESEND_API_KEY and RESEND_FROM_EMAIL should be set together — transactional email is disabled until both are present.');
  }
  // Support bridge needs both halves.
  if (Boolean(val('PULSE_URL')) !== Boolean(val('ADMIN_ADAPTER_SECRET'))) {
    warnings.push('PULSE_URL and ADMIN_ADAPTER_SECRET should be set together — the support bridge / admin adapter stays disabled until both are present.');
  }

  // ── Recommended in production — warn when unset so operators notice ─────────
  if (isProd()) {
    const recommended: Array<[keyof ServerEnv, string]> = [
      ['CRON_SECRET', 'scheduled jobs (SLA scans, fan-outs) will refuse to run'],
      ['SENTRY_DSN', 'server errors are logged locally only, not reported'],
      ['RESEND_API_KEY', 'transactional email (invites, password resets) is disabled'],
    ];
    for (const [k, effect] of recommended) {
      if (!val(k)) warnings.push(`${k} is not set — ${effect}.`);
    }
  }

  for (const w of warnings) console.warn(`[env] ${w}`);

  if (errors.length > 0) {
    throw new Error(
      `[env] Invalid server environment:\n${errors.map((e) => `  • ${e}`).join('\n')}\n` +
        'Set the missing variable(s) in your deployment environment and redeploy.',
    );
  }
}
