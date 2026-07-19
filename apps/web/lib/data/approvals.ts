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
