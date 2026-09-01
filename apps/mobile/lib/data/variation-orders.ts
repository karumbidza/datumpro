import { supabase, currentUser } from '../supabase';

export type VariationOrderStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/** A project-level change order (variation_orders) — numbered, with a cost/time
 *  impact and its own approval status. Distinct from the item/subtask variations
 *  in variations.ts; these are the ones raised for a manager's decision. */
export interface VariationOrder {
  id: string;
  number: number;
  reference: string | null;
  description: string;
  costImpactCents: number;
  timeImpactDays: number;
  status: VariationOrderStatus;
  createdByName: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  number: number;
  reference: string | null;
  description: string;
  cost_impact_cents: number;
  time_impact_days: number;
  status: VariationOrderStatus;
  created_by: string | null;
  created_at: string;
};

const SELECT = 'id, number, reference, description, cost_impact_cents, time_impact_days, status, created_by, created_at';

async function resolveNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Every change order on a project (newest number first). RLS scopes to members. */
export async function listProjectVariationOrders(projectId: string): Promise<VariationOrder[]> {
  const { data } = await supabase
    .from('variation_orders')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('number', { ascending: false });
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const names = await resolveNames(rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    reference: r.reference,
    description: r.description,
    costImpactCents: r.cost_impact_cents,
    timeImpactDays: r.time_impact_days,
    status: r.status,
    createdByName: r.created_by ? names.get(r.created_by) ?? null : null,
    createdAt: r.created_at,
  }));
}

/** owner/admin/pm — who may decide a change order (also enforced by RLS). */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const orgId = (proj as { org_id: string } | null)?.org_id;
  if (!orgId) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

/** Approve or reject a submitted change order. Mirrors the web decide(): the DB
 *  RLS/approval order is the real gate; the raiser is notified. */
export async function decideVariationOrder(
  id: string,
  projectId: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: vo } = await supabase
    .from('variation_orders')
    .select('org_id, number, description, status, created_by')
    .eq('id', id)
    .maybeSingle();
  const v = vo as { org_id: string; number: number; description: string; status: string; created_by: string | null } | null;
  if (!v) throw new Error('Change order not found.');
  if (v.status !== 'submitted') throw new Error('Only a submitted change order can be decided.');

  const patch =
    decision === 'approved'
      ? { status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(), decided_at: new Date().toISOString() }
      : { status: 'rejected', decided_at: new Date().toISOString() };
  const { error } = await supabase.from('variation_orders').update(patch).eq('id', id);
  if (error) throw new Error(error.message);

  if (v.created_by && v.created_by !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    const pname = (proj as { name: string } | null)?.name ?? 'a project';
    try {
      await supabase.rpc('notify', {
        p_org: v.org_id,
        p_user: v.created_by,
        p_type: decision === 'approved' ? 'variation_approved' : 'variation_rejected',
        p_title: `VO #${v.number} ${decision} — ${pname}`,
        p_body: v.description,
        p_link: `/projects/${projectId}/variations`,
        p_entity_type: 'task',
        p_entity_id: id,
      });
    } catch {
      /* best-effort */
    }
  }
}
