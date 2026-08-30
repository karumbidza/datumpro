import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Variation, VariationStatus, VariationTotals } from './variations-types';

export type { Variation, VariationStatus, VariationTotals } from './variations-types';

type VariationRow = {
  id: string;
  number: number;
  project_id: string;
  reference: string | null;
  description: string;
  cost_impact_cents: number;
  time_impact_days: number;
  status: VariationStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decided_at: string | null;
  created_at: string;
};

const SELECT =
  'id, number, project_id, reference, description, cost_impact_cents, time_impact_days, status, created_by, approved_by, approved_at, decided_at, created_at';

async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

export interface ProjectVariations {
  variations: Variation[];
  totals: VariationTotals;
}

/** Every variation order on a project (RLS scopes to members/staff), newest
 *  first, plus the running contract-impact totals across approved variations. */
export async function listProjectVariations(projectId: string): Promise<ProjectVariations> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('variation_orders')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('number', { ascending: false });
  const rows = (data ?? []) as VariationRow[];

  const names = await resolveNames(supabase, [
    ...rows.map((r) => r.created_by),
    ...rows.map((r) => r.approved_by),
  ]);

  const variations: Variation[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    reference: r.reference,
    description: r.description,
    costImpactCents: r.cost_impact_cents,
    timeImpactDays: r.time_impact_days,
    status: r.status,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
    approvedAt: r.approved_at,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  }));

  const approved = variations.filter((v) => v.status === 'approved');
  const totals: VariationTotals = {
    approvedCostCents: approved.reduce((sum, v) => sum + v.costImpactCents, 0),
    approvedTimeDays: approved.reduce((sum, v) => sum + v.timeImpactDays, 0),
    pendingCount: variations.filter((v) => v.status === 'submitted').length,
  };

  return { variations, totals };
}
