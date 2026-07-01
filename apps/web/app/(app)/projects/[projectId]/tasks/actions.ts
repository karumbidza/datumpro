'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTaskSchema } from '@datumpro/shared/validation';

const DAY_MS = 24 * 60 * 60 * 1000;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** Log a timeline entry. Best-effort — never blocks the main action. */
async function logActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  task: { id: string; org_id: string },
  userId: string,
  type: string,
  message: string,
) {
  await supabase
    .from('task_activity')
    .insert({ org_id: task.org_id, task_id: task.id, user_id: userId, type, message });
}

async function loadTask(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string) {
  const { data } = await supabase
    .from('tasks')
    .select('id, org_id, project_id, status, due_date, sla_clock_paused_at, sla_total_paused_ms')
    .eq('id', taskId)
    .maybeSingle();
  return data as
    | {
        id: string;
        org_id: string;
        project_id: string;
        status: string;
        due_date: string | null;
        sla_clock_paused_at: string | null;
        sla_total_paused_ms: number;
      }
    | null;
}

export async function createTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');

  const parsed = createTaskSchema.safeParse({
    projectId,
    title: String(formData.get('title') ?? ''),
    description: (formData.get('description') as string) || undefined,
    priority: (formData.get('priority') as string) || 'medium',
    assigneeId: (formData.get('assigneeId') as string) || undefined,
    dueDate: (formData.get('dueDate') as string) || undefined,
    plannedStartDate: (formData.get('plannedStartDate') as string) || undefined,
    plannedEndDate: (formData.get('plannedEndDate') as string) || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(', '));

  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) throw new Error('Project not found or access denied');
  const orgId = (project as { org_id: string }).org_id;

  const { data: created, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      project_id: projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId ?? null,
      due_date: parsed.data.dueDate ?? null,
      planned_start_date: parsed.data.plannedStartDate ?? null,
      planned_end_date: parsed.data.plannedEndDate ?? null,
      baseline_start_date: parsed.data.plannedStartDate ?? null,
      baseline_end_date: parsed.data.plannedEndDate ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await logActivity(supabase, { id: (created as { id: string }).id, org_id: orgId }, user.id, 'created', 'Task created');
  revalidatePath(`/projects/${projectId}/tasks`);
  redirect(`/projects/${projectId}/tasks/${(created as { id: string }).id}`);
}

export async function updateTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const title = String(formData.get('title') ?? '').trim();
  if (title.length < 2) throw new Error('Title is required');

  const { error } = await supabase
    .from('tasks')
    .update({
      title,
      description: (formData.get('description') as string)?.trim() || null,
      priority: (formData.get('priority') as string) || 'medium',
      assignee_id: (formData.get('assigneeId') as string) || null,
      planned_start_date: (formData.get('plannedStartDate') as string) || null,
      planned_end_date: (formData.get('plannedEndDate') as string) || null,
      due_date: (formData.get('dueDate') as string) || null,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  await logActivity(supabase, task, user.id, 'updated', 'Task details updated');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  redirect(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** Add a predecessor dependency (predecessor must finish, plus lag, before this
 *  task). The DB rejects cycles and duplicates; we translate those to clear
 *  messages. RLS limits this to the project's PM / org admins. */
export async function addDependency(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const predecessorId = String(formData.get('predecessorId') ?? '');
  const lagDaysRaw = Number(formData.get('lagDays') ?? 0);
  if (!predecessorId) throw new Error('Choose a predecessor task');
  if (predecessorId === taskId) throw new Error('A task cannot depend on itself');

  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { error } = await supabase.from('task_dependencies').insert({
    org_id: task.org_id,
    predecessor_id: predecessorId,
    successor_id: taskId,
    lag_days: Number.isFinite(lagDaysRaw) ? Math.trunc(lagDaysRaw) : 0,
  });
  if (error) {
    if (/circular/i.test(error.message)) throw new Error('That would create a circular dependency');
    if (/duplicate|unique/i.test(error.message)) throw new Error('That dependency already exists');
    throw new Error(error.message);
  }
  await logActivity(supabase, task, user.id, 'dependency', 'Added a dependency');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function removeDependency(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const dependencyId = String(formData.get('dependencyId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('id', dependencyId)
    .eq('successor_id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'dependency', 'Removed a dependency');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function startTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', sla_status: 'on_track', actual_start_date: now, sla_clock_started_at: now })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', 'Started the task');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function submitTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();
  const declaration = formData.get('declaration') === 'on';
  if (notes.length < 10) throw new Error('Describe what was completed (min 10 chars)');
  if (!declaration) throw new Error('You must confirm the declaration');

  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'submitted',
      sla_status: 'pending_signoff',
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
      completion_notes: notes,
      declaration_confirmed: true,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', 'Submitted for sign-off');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function approveTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const now = new Date();
  const onTime = !task.due_date || now <= new Date(`${task.due_date}T23:59:59Z`);
  // The DB sign-off guard rejects this if the caller isn't a lead.
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      sla_status: onTime ? 'resolved_on_time' : 'resolved_late',
      approved_at: now.toISOString(),
      approved_by: user.id,
      actual_end_date: now.toISOString(),
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message.includes('project manager') ? 'Only a project manager can approve this task' : error.message);
  await logActivity(supabase, task, user.id, 'status', `Approved — ${onTime ? 'on time' : 'late'}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function rejectTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) throw new Error('A rejection reason is required');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', sla_status: 'on_track', rejected_at: new Date().toISOString(), rejected_by: user.id, rejection_reason: reason })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', `Rejected: ${reason}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function raiseBlocker(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (!description) throw new Error('Describe the blocker');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'blocked',
      sla_status: 'blocked',
      blocker_raised_at: new Date().toISOString(),
      blocker_raised_by: user.id,
      blocker_description: description,
      blocker_resolved_at: null,
      sla_clock_paused_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'blocker', `Blocker raised: ${description}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function resolveBlocker(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  // Credit the blocked time back to the deadline (full-SLA semantics).
  const now = Date.now();
  const pausedSince = task.sla_clock_paused_at ? new Date(task.sla_clock_paused_at).getTime() : now;
  const pausedMs = Math.max(0, now - pausedSince);
  const creditedDue =
    task.due_date && pausedMs > 0
      ? new Date(new Date(`${task.due_date}T00:00:00Z`).getTime() + pausedMs).toISOString().slice(0, 10)
      : task.due_date;

  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'in_progress',
      sla_status: 'on_track',
      blocker_resolved_at: new Date().toISOString(),
      blocker_resolved_by: user.id,
      sla_clock_paused_at: null,
      sla_total_paused_ms: (task.sla_total_paused_ms ?? 0) + pausedMs,
      due_date: creditedDue,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'blocker', 'Blocker resolved — deadline credited');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}
