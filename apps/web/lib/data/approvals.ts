import { createClient } from '@/lib/supabase/server';

export interface ApprovalStep {
  id: string;
  entityId: string;
  stepOrder: number;
  approverRole: string;
  decision: 'pending' | 'approved' | 'rejected';
  approverName: string | null;
  decidedAt: string | null;
}

/** All approval steps for a set of entities of one type, keyed by entity id and
 *  ordered by step. Resolves the decider's name for completed steps. */
export async function stepsByEntity(
  entityType: string,
  entityIds: string[],
): Promise<Map<string, ApprovalStep[]>> {
  const map = new Map<string, ApprovalStep[]>();
  if (entityIds.length === 0) return map;
  const supabase = await createClient();
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

/** The earliest step still awaiting a decision (the one that's actionable). */
export function currentStep(steps: ApprovalStep[]): ApprovalStep | null {
  return steps.find((s) => s.decision === 'pending') ?? null;
}

/** The org's configured second approver role, or 'none' when the chain is a
 *  single PM-only approval. Step 1 is always the PM. Assumes the uniform chain
 *  the settings UI writes (same across every approvable type). */
export async function getOrgSecondApprover(orgId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('approval_policies')
    .select('approver_role')
    .eq('org_id', orgId)
    .eq('entity_type', 'task_plan')
    .eq('step_order', 2)
    .maybeSingle();
  return (data as { approver_role: string } | null)?.approver_role ?? 'none';
}

export interface ApprovalMatrixRow {
  entityType: string;
  extraRoles: string[]; // approver roles for steps 2..N, in order
  minAmountCents: number; // threshold above which the extra steps apply
}

/** Current per-entity-type approval chains (steps 2..N + threshold). Step 1 is
 *  always PM and is not returned. */
export async function getOrgApprovalMatrix(orgId: string): Promise<ApprovalMatrixRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('approval_policies')
    .select('entity_type, step_order, approver_role, min_amount_cents')
    .eq('org_id', orgId)
    .order('entity_type', { ascending: true })
    .order('step_order', { ascending: true });
  const rows = (data ?? []) as { entity_type: string; step_order: number; approver_role: string; min_amount_cents: number }[];
  const byType = new Map<string, ApprovalMatrixRow>();
  for (const r of rows) {
    let m = byType.get(r.entity_type);
    if (!m) { m = { entityType: r.entity_type, extraRoles: [], minAmountCents: 0 }; byType.set(r.entity_type, m); }
    if (r.step_order >= 2) { m.extraRoles.push(r.approver_role); m.minAmountCents = r.min_amount_cents; }
  }
  return [...byType.values()];
}
