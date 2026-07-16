import { supabase, currentUser} from '../supabase';

export type VariationStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Variation {
  id: string;
  reference: string | null;
  description: string;
  costImpactCents: number;
  timeImpactDays: number;
  status: VariationStatus;
  raiserName: string | null;
}

/** Change orders for a project, newest first, with the raiser's name. RLS scopes
 *  to project members. */
export async function listVariations(projectId: string): Promise<Variation[]> {
  const { data } = await supabase
    .from('variation_orders')
    .select('id, reference, description, cost_impact_cents, time_impact_days, status, created_by')
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
  }[];

  const ids = [...new Set(raw.map((r) => r.created_by).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
    names = new Map(
      ((profs ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
        p.id,
        p.display_name || p.email || 'Member',
      ]),
    );
  }

  return raw.map((r) => ({
    id: r.id,
    reference: r.reference,
    description: r.description,
    costImpactCents: r.cost_impact_cents,
    timeImpactDays: r.time_impact_days,
    status: r.status,
    raiserName: r.created_by ? names.get(r.created_by) ?? null : null,
  }));
}

/** Raise a variation. RLS forces a non-manager's row to 'submitted'. */
export async function raiseVariation(params: {
  projectId: string;
  description: string;
  costCents: number;
  timeDays: number;
  reference?: string | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', params.projectId)
    .maybeSingle();
  if (!project) throw new Error('Project not found');

  const { error } = await supabase.from('variation_orders').insert({
    org_id: (project as { org_id: string }).org_id,
    project_id: params.projectId,
    reference: params.reference?.trim() || null,
    description: params.description.trim(),
    cost_impact_cents: params.costCents,
    time_impact_days: Math.trunc(params.timeDays),
    status: 'submitted',
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
}

/** Approve or reject a submitted variation (managers only; RLS enforces). */
export async function decideVariation(variationId: string, approve: boolean): Promise<void> {
  const user = await currentUser();
  const { error } = await supabase
    .from('variation_orders')
    .update({
      status: approve ? 'approved' : 'rejected',
      approved_by: approve ? user?.id ?? null : null,
      approved_at: approve ? new Date().toISOString() : null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', variationId);
  if (error) throw new Error(error.message);
}
