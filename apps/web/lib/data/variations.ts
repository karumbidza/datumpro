import { createClient } from '@/lib/supabase/server';

export type VariationStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface VariationRow {
  id: string;
  reference: string | null;
  description: string;
  costImpactCents: number;
  timeImpactDays: number;
  status: VariationStatus;
  raiserName: string | null;
  createdAt: string;
}

export interface VariationsResult {
  rows: VariationRow[];
  /** Net cost/time impact of APPROVED variations, plus a pending count. */
  approvedCostCents: number;
  approvedDays: number;
  pendingCount: number;
}

/** Change orders for a project, newest first, with the raiser's name. RLS scopes
 *  to project members; the panel decides who may raise vs decide. */
export async function listVariations(projectId: string): Promise<VariationsResult> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('variation_orders')
    .select('id, reference, description, cost_impact_cents, time_impact_days, status, created_by, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const raw = (data ?? []) as {
    id: string;
    reference: string | null;
    description: string;
    cost_impact_cents: number;
    time_impact_days: number;
    status: VariationStatus;
    created_by: string | null;
    created_at: string;
  }[];

  const userIds = [...new Set(raw.map((r) => r.created_by).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', userIds);
    names = new Map(
      ((profs ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
        p.id,
        p.display_name || p.email || 'Member',
      ]),
    );
  }

  const rows: VariationRow[] = raw.map((r) => ({
    id: r.id,
    reference: r.reference,
    description: r.description,
    costImpactCents: r.cost_impact_cents,
    timeImpactDays: r.time_impact_days,
    status: r.status,
    raiserName: r.created_by ? names.get(r.created_by) ?? null : null,
    createdAt: r.created_at,
  }));

  const approved = rows.filter((r) => r.status === 'approved');
  return {
    rows,
    approvedCostCents: approved.reduce((s, r) => s + r.costImpactCents, 0),
    approvedDays: approved.reduce((s, r) => s + r.timeImpactDays, 0),
    pendingCount: rows.filter((r) => r.status === 'submitted').length,
  };
}
