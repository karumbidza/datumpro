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

/** Bulk-assign generated tasks to one contractor. The assignee is enrolled as a
 *  project contractor first (idempotent, mirroring the award export), so the
 *  pending-acceptance trigger fires for them; each task then flows through the
 *  normal accept → plan → approval chain. RLS restricts the task update to
 *  admin/PM. Bill-generated subtasks survive the assignment (trigger keeps
 *  boq_item_id lines). */
export async function bulkAssignBoqTasks(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const assigneeId = String(formData.get('assigneeId') ?? '');
  const taskIds = formData.getAll('taskIds').map(String).filter(Boolean);
  if (!assigneeId) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent('Pick a contractor.')}`);
  if (taskIds.length === 0)
    redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent('Tick at least one task.')}`);

  const { error: me } = await supabase
    .from('project_members')
    .upsert(
      { org_id: orgId, project_id: projectId, user_id: assigneeId, role: 'contractor' },
      { onConflict: 'project_id,user_id', ignoreDuplicates: true },
    );
  if (me) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(me.message)}`);

  const { error } = await supabase
    .from('tasks')
    .update({ assignee_id: assigneeId })
    .eq('project_id', projectId)
    .in('id', taskIds);
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);

  revalidatePath(`/projects/${projectId}/boq`);
  revalidatePath(`/projects/${projectId}/tasks`);
}

/** Run the programme scheduler: no-predecessor tasks start on the given date
 *  (concurrent), successors chain off their predecessors, ends come from each
 *  task's agreed duration in working days. Only 'todo' tasks are rewritten. */
export async function scheduleTasks(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const startDate = String(formData.get('startDate') ?? '');
  const { data, error } = await supabase.rpc('schedule_boq_tasks', {
    p_project_id: projectId,
    p_boq_id: boqId,
    p_start_date: startDate,
  });
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);

  const res = data as unknown as {
    scheduled: number;
    frozen: number;
    missing_duration: string[];
    project_end: string | null;
  };
  const bits = [`${res.scheduled} task${res.scheduled === 1 ? '' : 's'} scheduled`];
  if (res.frozen > 0) bits.push(`${res.frozen} already started (kept)`);
  if (res.project_end) bits.push(`finishes ${res.project_end}`);
  if (res.missing_duration.length > 0)
    bits.push(`no duration set: ${res.missing_duration.join(', ')}`);
  revalidatePath(`/projects/${projectId}/boq`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/boq?notice=${encodeURIComponent(bits.join(' · '))}`);
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
