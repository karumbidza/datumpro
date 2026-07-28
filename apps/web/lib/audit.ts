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
 *  (bypasses RLS; writes are otherwise impossible). Best-effort by design: it
 *  never throws, so an audit hiccup — or a missing SUPABASE_SERVICE_ROLE_KEY in
 *  local dev — can't break the user action that triggered it. Call it AFTER the
 *  user's own mutation has succeeded. */
export async function logAudit(entry: AuditEntry): Promise<void> {
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
    if (error) console.error('[audit] insert failed:', error.message);
  } catch (e) {
    console.error('[audit] logAudit error:', e);
  }
}
