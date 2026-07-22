import { supabase, currentUser} from '../supabase';
import { createTaskSchema } from '@datumpro/shared/validation';

/**
 * Task lifecycle transitions, mirroring the web server actions. These run under
 * the user's session, so RLS and the DB sign-off guard enforce authority — e.g.
 * `approveTask` is rejected by the database unless the caller is a project lead.
 */

async function meId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}

async function logActivity(orgId: string, taskId: string, type: string, message: string) {
  const uid = await meId();
  await supabase.from('task_activity').insert({ org_id: orgId, task_id: taskId, user_id: uid, type, message });
}

/** todo → in_progress (assignee). */
export async function startTask(taskId: string, orgId: string) {
  // A task that went through acceptance can't start until its priced plan is
  // approved (the DB enforces this too).
  const { data: t } = await supabase
    .from('tasks')
    .select('acceptance_status, plan_approved_at')
    .eq('id', taskId)
    .maybeSingle();
  const task = t as { acceptance_status: string | null; plan_approved_at: string | null } | null;
  if (task && task.acceptance_status !== null && !task.plan_approved_at) {
    throw new Error('Your plan must be approved before you can start this task.');
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', sla_status: 'on_track', actual_start_date: now, sla_clock_started_at: now })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(orgId, taskId, 'status', 'Started the task');
}

/** in_progress → submitted (assignee). Evidence-gated when the task requires it. */
export async function submitTask(params: { taskId: string; orgId: string; notes: string }) {
  const notes = params.notes.trim();
  if (notes.length < 10) throw new Error('Describe what was completed (min 10 characters).');
  // Evidence is optional — attaching a photo/doc is encouraged but never blocks
  // submitting (some tasks are document deliverables, e.g. licences).
  // Plan gate: every item in the agreed scope (baseline + approved variations)
  // must be ticked first. Pending/rejected variations don't block completion.
  const { data: subs } = await supabase
    .from('task_subtasks')
    .select('is_done, is_variation, variation_status')
    .eq('task_id', params.taskId);
  const counted = ((subs ?? []) as { is_done: boolean; is_variation: boolean; variation_status: string | null }[]).filter(
    (s) => !s.is_variation || s.variation_status === 'approved',
  );
  if (counted.length > 0 && counted.some((s) => !s.is_done)) {
    throw new Error('Complete every item in your task plan before submitting for approval.');
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

/** in_progress → blocked (assignee). Pauses the SLA clock until a lead resolves
 *  it; mirrors the web raiseBlocker. */
export async function raiseBlocker(taskId: string, orgId: string, description: string) {
  const desc = description.trim();
  if (!desc) throw new Error('Describe the blocker.');
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'blocked',
      sla_status: 'blocked',
      blocker_raised_at: now,
      blocker_raised_by: await meId(),
      blocker_description: desc,
      blocker_resolved_at: null,
      sla_clock_paused_at: now,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(orgId, taskId, 'blocker', `Blocker raised: ${desc}`);
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
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}): Promise<string> {
  const parsed = createTaskSchema.safeParse({
    projectId: input.projectId,
    title: input.title,
    description: input.description || undefined,
    priority: input.priority || 'medium',
    assigneeId: input.assigneeId || undefined,
    plannedStartDate: input.plannedStartDate || undefined,
    plannedEndDate: input.plannedEndDate || undefined,
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
      // The end date IS the due date.
      due_date: parsed.data.plannedEndDate ?? null,
      planned_start_date: parsed.data.plannedStartDate ?? null,
      planned_end_date: parsed.data.plannedEndDate ?? null,
      baseline_start_date: parsed.data.plannedStartDate ?? null,
      baseline_end_date: parsed.data.plannedEndDate ?? null,
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
