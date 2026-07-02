import { supabase } from '../supabase';
import { createTaskSchema } from '@datumpro/shared/validation';

/**
 * Task lifecycle transitions, mirroring the web server actions. These run under
 * the user's session, so RLS and the DB sign-off guard enforce authority — e.g.
 * `approveTask` is rejected by the database unless the caller is a project lead.
 */

async function meId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function logActivity(orgId: string, taskId: string, type: string, message: string) {
  const uid = await meId();
  await supabase.from('task_activity').insert({ org_id: orgId, task_id: taskId, user_id: uid, type, message });
}

/** todo → in_progress (assignee). */
export async function startTask(taskId: string, orgId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', sla_status: 'on_track', actual_start_date: now, sla_clock_started_at: now })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(orgId, taskId, 'status', 'Started the task');
}

/** in_progress → submitted (assignee). Evidence-gated when the task requires it. */
export async function submitTask(params: {
  taskId: string;
  orgId: string;
  notes: string;
  requiresPhoto: boolean;
}) {
  const notes = params.notes.trim();
  if (notes.length < 10) throw new Error('Describe what was completed (min 10 characters).');
  if (params.requiresPhoto) {
    const { count } = await supabase
      .from('task_media')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', params.taskId)
      .eq('purpose', 'completion');
    if ((count ?? 0) === 0) throw new Error('Attach at least one completion photo before submitting.');
  }
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'submitted',
      sla_status: 'pending_signoff',
      submitted_at: new Date().toISOString(),
      submitted_by: await meId(),
      completion_notes: notes,
      closing_report: notes,
      declaration_confirmed: true,
    })
    .eq('id', params.taskId);
  if (error) throw new Error(error.message);
  await logActivity(params.orgId, params.taskId, 'status', 'Submitted for sign-off');
}

/** submitted → done (project lead only; the DB guard enforces it). */
export async function approveTask(params: { taskId: string; orgId: string; dueDate: string | null }) {
  const now = new Date();
  const onTime = !params.dueDate || now <= new Date(`${params.dueDate}T23:59:59Z`);
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      sla_status: onTime ? 'resolved_on_time' : 'resolved_late',
      approved_at: now.toISOString(),
      approved_by: await meId(),
      actual_end_date: now.toISOString(),
    })
    .eq('id', params.taskId);
  if (error) {
    throw new Error(
      error.message.includes('project manager') ? 'Only a project manager can approve this task.' : error.message,
    );
  }
  await logActivity(params.orgId, params.taskId, 'status', `Approved — ${onTime ? 'on time' : 'late'}`);
}

/** Create a task in a project (project lead — RLS enforces). Returns the new id.
 *  Validates with the same shared schema the web uses. */
export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string;
  priority: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<string> {
  const parsed = createTaskSchema.safeParse({
    projectId: input.projectId,
    title: input.title,
    description: input.description || undefined,
    priority: input.priority || 'medium',
    assigneeId: input.assigneeId || undefined,
    dueDate: input.dueDate || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(', '));

  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', input.projectId)
    .maybeSingle();
  if (!project) throw new Error('Project not found or access denied.');
  const orgId = (project as { org_id: string }).org_id;

  const { data: created, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      project_id: input.projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId ?? null,
      due_date: parsed.data.dueDate ?? null,
      created_by: await meId(),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = (created as { id: string }).id;
  await logActivity(orgId, id, 'created', 'Task created');
  return id;
}

/** submitted → in_progress with a reason (project lead). */
export async function rejectTask(params: { taskId: string; orgId: string; reason: string }) {
  const reason = params.reason.trim();
  if (!reason) throw new Error('A rejection reason is required.');
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'in_progress',
      sla_status: 'on_track',
      rejected_at: new Date().toISOString(),
      rejected_by: await meId(),
      rejection_reason: reason,
    })
    .eq('id', params.taskId);
  if (error) throw new Error(error.message);
  await logActivity(params.orgId, params.taskId, 'status', `Rejected: ${reason}`);
}
