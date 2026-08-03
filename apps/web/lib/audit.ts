import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** Append an entry to the tamper-evident `audit_logs` table via the service role
 *  (bypasses RLS; writes are otherwise impossible). Never throws, so an audit
 *  hiccup can't break the user action that triggered it — but a FAILURE is a gap
 *  in the compliance trail, so it's logged at CRITICAL and (if AUDIT_ALERT_WEBHOOK
 *  is set) pushed to an out-of-band alert sink rather than swallowed silently.
 *  Returns whether the write succeeded, for callers that want to react. Call it
 *  AFTER the user's own mutation has succeeded. */
export async function logAudit(entry: AuditEntry): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('audit_logs').insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      before: (entry.before ?? null) as never,
      after: (entry.after ?? null) as never,
    });
    if (error) {
      await reportAuditFailure(entry, error.message);
      return false;
    }
    return true;
  } catch (e) {
    await reportAuditFailure(entry, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Surface a dropped audit write loudly. Logs a CRITICAL line monitoring can
 *  alert on, and best-effort POSTs to AUDIT_ALERT_WEBHOOK if configured. Carries
 *  only the entry's metadata (never before/after payloads) to avoid leaking data
 *  into logs/alerts. Itself never throws. */
async function reportAuditFailure(entry: AuditEntry, reason: string): Promise<void> {
  const summary = {
    orgId: entry.orgId,
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    action: entry.action,
    reason,
  };
  // Distinct, greppable marker so this stands out from routine info logs.
  console.error('[audit][CRITICAL] audit write dropped —', JSON.stringify(summary));

  const webhook = process.env.AUDIT_ALERT_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'audit_write_failed', ...summary }),
    });
  } catch (e) {
    console.error('[audit][CRITICAL] alert webhook also failed:', e instanceof Error ? e.message : String(e));
  }
}
