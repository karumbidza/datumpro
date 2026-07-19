import { supabase, currentUser } from '../supabase';

/** Mirrors the web ApprovalStep — one canonical shape across both clients. */
export interface ApprovalStep {
  id: string;
  entityId: string;
  stepOrder: number;
  approverRole: string;
  decision: 'pending' | 'approved' | 'rejected';
  approverName: string | null;
  decidedAt: string | null;
}

/** Approval steps for a set of entities of one type, keyed by entity id, ordered
 *  by step. Reads the same tables/columns the web does. */
export async function stepsByEntity(
  entityType: string,
  entityIds: string[],
): Promise<Map<string, ApprovalStep[]>> {
  const map = new Map<string, ApprovalStep[]>();
  if (entityIds.length === 0) return map;
  const { data } = await supabase
    .from('approvals')
    .select('id, entity_id, step_order, approver_role, decision, approver_id, decided_at')
    .eq('entity_type', entityType)
    .in('entity_id', entityIds)
    .order('step_order', { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    entity_id: string;
    step_order: number;
    approver_role: string;
    decision: 'pending' | 'approved' | 'rejected';
    approver_id: string | null;
    decided_at: string | null;
  }[];

  const approverIds = [...new Set(rows.map((r) => r.approver_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (approverIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', approverIds);
    for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
      names.set(p.id, p.display_name ?? p.email ?? 'Member');
    }
  }

  for (const r of rows) {
    const step: ApprovalStep = {
      id: r.id,
      entityId: r.entity_id,
      stepOrder: r.step_order,
      approverRole: r.approver_role,
      decision: r.decision,
      approverName: r.approver_id ? names.get(r.approver_id) ?? 'Member' : null,
      decidedAt: r.decided_at,
    };
    const arr = map.get(r.entity_id) ?? [];
    arr.push(step);
    map.set(r.entity_id, arr);
  }
  return map;
}

/** The earliest step still awaiting a decision (the actionable one). */
export function currentStep(steps: ApprovalStep[]): ApprovalStep | null {
  return steps.find((s) => s.decision === 'pending') ?? null;
}

/** Decide one step. Same as web decideApprovalStep — the DB finalizes + applies
 *  the entity effect; SoD blocks approving your own item. */
export async function decideApprovalStep(approvalId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const user = await currentUser();
  const { error } = await supabase
    .from('approvals')
    .update({ decision, approver_id: user?.id ?? null, decided_at: new Date().toISOString() })
    .eq('id', approvalId);
  if (error) {
    throw new Error(
      error.message.includes('segregation of duties') ? 'You cannot approve your own request' : error.message,
    );
  }
}

/** The current user's org role — drives who can act on which step. */
export async function myOrgRole(orgId: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}
