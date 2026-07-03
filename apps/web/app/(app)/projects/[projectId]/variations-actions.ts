'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const toCents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100);

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** Raise a variation (change order). Any project member may propose one; RLS
 *  forces a non-manager's row to 'submitted', so this always submits for review.
 *  cost/time impact may be negative (a credit / time saved). */
export async function raiseVariation(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (!projectId) throw new Error('Missing project');
  if (!description) throw new Error('Describe the change');

  const { data: project } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (!project) throw new Error('Project not found');

  const { error } = await supabase.from('variation_orders').insert({
    org_id: (project as { org_id: string }).org_id,
    project_id: projectId,
    reference: (formData.get('reference') as string)?.trim() || null,
    description,
    cost_impact_cents: toCents(formData.get('cost')),
    time_impact_days: Math.trunc(Number(formData.get('timeDays')) || 0),
    status: 'submitted',
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

/** Approve or reject a submitted variation. RLS restricts the UPDATE to a
 *  manager (org admin or the project PM). */
export async function decideVariation(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const variationId = String(formData.get('variationId') ?? '');
  const approve = String(formData.get('decision') ?? '') === 'approve';
  if (!variationId) throw new Error('Missing variation');

  const { error } = await supabase
    .from('variation_orders')
    .update({
      status: approve ? 'approved' : 'rejected',
      approved_by: approve ? user.id : null,
      approved_at: approve ? new Date().toISOString() : null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', variationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
