'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';

/** Signed-in user + active org, or bounce — same shape as the BOQ actions.
 *  All writes run under RLS (org admin/PM for boqs); the generate RPC guards itself. */
async function requireOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  return { supabase, userId: user.id, orgId: ctx.active.orgId };
}

/** Attach an existing unlinked bill to this project (no task generation yet). */
export async function attachBoq(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase
    .from('boqs')
    .update({ project_id: projectId })
    .eq('id', boqId)
    .is('project_id', null);
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
}

/** Create a draft bill pre-filled from the project and open the builder. */
export async function createProjectBoq(formData: FormData): Promise<void> {
  const { supabase, userId, orgId } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');

  const { data: proj } = await supabase
    .from('projects')
    .select('name, client_id, currency')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!proj) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent('Project not found.')}`);
  const p = proj as { name: string; client_id: string | null; currency: string };

  const { data: nb, error } = await supabase
    .from('boqs')
    .insert({
      org_id: orgId,
      name: p.name,
      boq_type: 'measured',
      client_id: p.client_id,
      currency: p.currency,
      project_id: projectId,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error || !nb)
    redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error?.message ?? 'Could not create the BOQ.')}`);
  redirect(`/boq/${(nb as { id: string }).id}`);
}

/** Generate unassigned budget-priced tasks from the linked bill (RPC guards +
 *  idempotency live in the database). */
export async function generateBoqTasks(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase.rpc('generate_tasks_from_boq', {
    p_boq_id: boqId,
    p_project_id: projectId,
  });
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
  revalidatePath(`/projects/${projectId}/tasks`);
  redirect(`/projects/${projectId}/tasks`);
}

/** Detach the bill. Generated tasks stay — they are real work; only the link goes. */
export async function unlinkBoq(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase
    .from('boqs')
    .update({ project_id: null })
    .eq('id', boqId)
    .eq('project_id', projectId);
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
}
