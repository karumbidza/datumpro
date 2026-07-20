'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTaskSchema } from '@datumpro/shared/validation';
import { parsePaymentTerms } from '@datumpro/shared/domain';
import { completionMediaCount } from '@/lib/data/quotes';
import { notifyUser, notifyProjectManagers } from '@/lib/data/notifications';
import type { FormState } from '@/components/ui/form-error';
import { emailUser } from '@/lib/email/notify';
import { quoteAwardedEmail, appUrl } from '@/lib/email/templates';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** The project role to enrol a task assignee at, from their org member type —
 *  mirrors enforce_project_role_for_type so the insert is always accepted. A
 *  contractor stays a contractor (never a PM); clients/viewers stay read-only. */
function projectRoleForMemberType(memberType: string): 'contractor' | 'client' | 'viewer' | 'contributor' {
  switch (memberType) {
    case 'contractor':
      return 'contractor';
    case 'client':
      return 'client';
    case 'finance':
    case 'viewer':
      return 'viewer';
    default:
      return 'contributor'; // owner / admin / pm / staff
  }
}

/** Ensure a user is a member of the project so a task can be assigned to them
 *  (the tasks_assignee_member trigger requires it). Assigning to anyone in the
 *  org is thus safe: it enrols them at their type-correct role, never elevating a
 *  contractor. Returns an error string, or null on success. */
async function ensureProjectMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return null;

  const { data: om } = await supabase
    .from('org_members')
    .select('member_type')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!om) return 'That person is not a member of this organisation.';

  const role = projectRoleForMemberType((om as { member_type: string }).member_type);
  const { error } = await supabase
    .from('project_members')
    .insert({ org_id: orgId, project_id: projectId, user_id: userId, role });
  if (error) return error.message;
  return null;
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
    .select(
      'id, org_id, project_id, title, status, due_date, sla_clock_paused_at, sla_total_paused_ms, requires_photo_on_complete, acceptance_status, plan_approved_at',
    )
    .eq('id', taskId)
    .maybeSingle();
  return data as
    | {
        id: string;
        org_id: string;
        project_id: string;
        title: string;
        status: string;
        due_date: string | null;
        sla_clock_paused_at: string | null;
        sla_total_paused_ms: number;
        requires_photo_on_complete: boolean;
        acceptance_status: 'pending' | 'accepted' | 'rejected' | null;
        plan_approved_at: string | null;
      }
    | null;
}

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');

  // How the task is handled decides who (if anyone) it's assigned to.
  const mode = (String(formData.get('assignmentMode') ?? 'direct')) as 'direct' | 'tender' | 'unassigned';
  const assigneeId = mode === 'direct' ? (formData.get('assigneeId') as string) || undefined : undefined;
  if (mode === 'direct' && !assigneeId) {
    return { error: 'Choose who to assign this to — or pick Tender / Leave unassigned.' };
  }

  const parsed = createTaskSchema.safeParse({
    projectId,
    title: String(formData.get('title') ?? ''),
    description: (formData.get('description') as string) || undefined,
    priority: (formData.get('priority') as string) || 'medium',
    assigneeId,
    // The end date IS the due date — no separate Due field.
    plannedStartDate: (formData.get('plannedStartDate') as string) || undefined,
    plannedEndDate: (formData.get('plannedEndDate') as string) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') };

  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { error: 'Project not found or access denied.' };
  const orgId = (project as { org_id: string }).org_id;

  // Assigning to anyone in the org: enrol them on the project first (at their
  // type-correct role) so the assignee-must-be-a-member rule holds.
  if (parsed.data.assigneeId) {
    const enrolErr = await ensureProjectMember(supabase, orgId, projectId, parsed.data.assigneeId);
    if (enrolErr) return { error: enrolErr };
  }

  const { data: created, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      project_id: projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId ?? null,
      // End date drives the due date; both kept in sync for downstream consumers.
      due_date: parsed.data.plannedEndDate ?? null,
      planned_start_date: parsed.data.plannedStartDate ?? null,
      planned_end_date: parsed.data.plannedEndDate ?? null,
      baseline_start_date: parsed.data.plannedStartDate ?? null,
      baseline_end_date: parsed.data.plannedEndDate ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  const newId = (created as { id: string }).id;

  // Dependencies (optional): predecessors that must finish before this can start.
  // The task stays blocked until they're done; the DB cycle-check guards inserts.
  const predecessorIds = [...new Set(formData.getAll('predecessorIds').map(String).filter(Boolean))];
  if (predecessorIds.length > 0) {
    await supabase.from('task_dependencies').insert(
      predecessorIds.map((pid) => ({ org_id: orgId, predecessor_id: pid, successor_id: newId })),
    );
  }

  // Tender: invite the chosen contractors to bid — each builds a competing plan.
  if (mode === 'tender') {
    const contractorIds = [...new Set(formData.getAll('tenderContractorIds').map(String).filter(Boolean))];
    if (contractorIds.length > 0) {
      await supabase.from('task_tender_invites').insert(
        contractorIds.map((cid) => ({
          org_id: orgId,
          project_id: projectId,
          task_id: newId,
          contractor_id: cid,
          invited_by: user.id,
        })),
      );
      await Promise.all(
        contractorIds.map((cid) =>
          notifyUser(supabase, {
            orgId,
            userId: cid,
            type: 'tender_invited',
            title: 'Invited to tender',
            body: `You're invited to bid on “${parsed.data.title}” — build your plan and quote.`,
            link: `/projects/${projectId}/tasks/${newId}`,
            entityId: newId,
          }),
        ),
      );
    }
  }

  await logActivity(supabase, { id: newId, org_id: orgId }, user.id, 'created', 'Task created');
  if (parsed.data.assigneeId) {
    await notifyUser(supabase, {
      orgId,
      userId: parsed.data.assigneeId,
      type: 'task_assigned',
      title: 'New task assigned',
      body: `“${parsed.data.title}” — review and accept.`,
      link: `/projects/${projectId}/tasks/${newId}`,
      entityId: newId,
    });
  }
  revalidatePath(`/projects/${projectId}/tasks`);
  // Tender lands straight in the Tender panel to invite / compare bidders.
  redirect(`/projects/${projectId}/tasks/${newId}${mode === 'tender' ? '?tab=tender' : ''}`);
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
      // The end date IS the due date — keep them in sync.
      due_date: (formData.get('plannedEndDate') as string) || null,
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

  // Plan gate: a task that went through acceptance can't start until its priced
  // plan has been approved (baseline locked). The DB enforces this too.
  if (task.acceptance_status !== null && !task.plan_approved_at) {
    throw new Error('Your plan must be approved before you can start this task.');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', sla_status: 'on_track', actual_start_date: now, sla_clock_started_at: now })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', 'Started the task');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function submitTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();
  const declaration = formData.get('declaration') === 'on';
  if (notes.length < 10) return { error: 'Describe what was completed (at least 10 characters).' };
  if (!declaration) return { error: 'Please confirm the completion declaration.' };

  const task = await loadTask(supabase, taskId);
  if (!task) return { error: 'Task not found.' };

  // Evidence gate: photo/video proof is mandatory unless the task opts out.
  if (task.requires_photo_on_complete && (await completionMediaCount(taskId)) === 0) {
    return { error: 'Attach at least one completion photo or video before submitting.' };
  }

  // Plan gate: if a subtask plan exists, every item must be ticked off first.
  const { data: subs } = await supabase.from('task_subtasks').select('is_done').eq('task_id', taskId);
  if (subs && subs.length > 0 && (subs as { is_done: boolean }[]).some((s) => !s.is_done)) {
    return { error: 'Complete every item in your task plan before submitting for approval.' };
  }

  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'submitted',
      sla_status: 'pending_signoff',
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
      completion_notes: notes,
      closing_report: notes,
      declaration_confirmed: true,
    })
    .eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(supabase, task, user.id, 'status', 'Submitted for sign-off');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  return {};
}

// ── Task acceptance (assigned contractor) ────────────────────────────────────
export async function acceptTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase
    .from('tasks')
    .update({ acceptance_status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', 'Accepted the task');
  await notifyProjectManagers(supabase, {
    orgId: task.org_id,
    projectId: task.project_id,
    type: 'task_accepted',
    title: 'Task accepted',
    body: `“${task.title}” was accepted.`,
    link: `/projects/${task.project_id}/tasks/${taskId}`,
    entityId: taskId,
  });
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** Contractor declines an assigned task — it returns to the PM (unassigned). */
export async function declineTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase
    .from('tasks')
    .update({ acceptance_status: 'rejected', rejected_reason: reason || null, assignee_id: null })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', reason ? `Declined the task — ${reason}` : 'Declined the task');
  await notifyProjectManagers(supabase, {
    orgId: task.org_id,
    projectId: task.project_id,
    type: 'task_declined',
    title: 'Task declined',
    body: reason ? `“${task.title}” was declined — ${reason}` : `“${task.title}” was declined.`,
    link: `/projects/${task.project_id}/tasks/${taskId}`,
    entityId: taskId,
  });
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** Contractor hands an ALREADY-ACCEPTED task back to the PM (any time before
 *  submit), with a reason. The task returns to the pool: unassigned + reset. */
export async function returnTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  if (task.status === 'submitted' || task.status === 'done') {
    throw new Error('This task has already been submitted and can no longer be handed back.');
  }
  const { error } = await supabase
    .from('tasks')
    .update({
      assignee_id: null,
      acceptance_status: 'rejected',
      rejected_reason: reason || null,
      status: 'todo',
      sla_status: 'on_track',
      actual_start_date: null,
      sla_clock_started_at: null,
      sla_clock_paused_at: null,
      blocker_description: null,
      blocker_resolved_at: null,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'status', reason ? `Handed the task back — ${reason}` : 'Handed the task back');
  await notifyProjectManagers(supabase, {
    orgId: task.org_id,
    projectId: task.project_id,
    type: 'task_returned',
    title: 'Task handed back',
    body: reason ? `“${task.title}” was handed back — ${reason}` : `“${task.title}” was handed back.`,
    link: `/projects/${task.project_id}/tasks/${taskId}`,
    entityId: taskId,
  });
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

// ── Subtask plan (the contractor's to-do list) ───────────────────────────────
async function taskOrgProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
): Promise<{ org_id: string; project_id: string } | null> {
  const { data } = await supabase.from('tasks').select('org_id, project_id').eq('id', taskId).maybeSingle();
  return data as { org_id: string; project_id: string } | null;
}

export async function addSubtask(formData: FormData) {
  const { supabase } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;
  const info = await taskOrgProject(supabase, taskId);
  if (!info) throw new Error('Task not found');
  const { data: last } = await supabase
    .from('task_subtasks')
    .select('position')
    .eq('task_id', taskId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;
  const estUnitRaw = String(formData.get('estUnit') ?? '');
  const estUnit = estUnitRaw === 'hours' || estUnitRaw === 'days' ? estUnitRaw : null;
  const estQtyRaw = Number(formData.get('estQty'));
  const costRaw = Number(formData.get('cost')); // dollars from the form
  // is_variation / variation_status are set by the DB from the task's plan state.
  const { error } = await supabase.from('task_subtasks').insert({
    org_id: info.org_id,
    task_id: taskId,
    title,
    cost_cents: Number.isFinite(costRaw) ? Math.max(0, Math.round(costRaw * 100)) : 0,
    est_qty: Number.isFinite(estQtyRaw) && estQtyRaw > 0 ? estQtyRaw : null,
    est_unit: estUnit,
    planned_start_date: (formData.get('plannedStartDate') as string) || null,
    planned_end_date: (formData.get('plannedEndDate') as string) || null,
    position,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${info.project_id}/tasks/${taskId}`);
}

export async function updateSubtask(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const row: Record<string, unknown> = {};
  const title = formData.get('title');
  if (title !== null) row.title = String(title).trim();
  const cost = formData.get('cost'); // dollars from the form
  if (cost !== null) row.cost_cents = Math.max(0, Math.round((Number(cost) || 0) * 100));
  const qty = formData.get('estQty');
  if (qty !== null) row.est_qty = Number(qty) > 0 ? Number(qty) : null;
  const unit = formData.get('estUnit');
  if (unit !== null) row.est_unit = unit === 'hours' || unit === 'days' ? unit : null;
  const start = formData.get('plannedStartDate');
  if (start !== null) row.planned_start_date = String(start) || null;
  if (Object.keys(row).length > 0) {
    const { error } = await supabase.from('task_subtasks').update(row).eq('id', id);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

/** Contractor submits the priced plan for PM→Admin approval. Every baseline line
 *  needs a cost, a duration and a start date; the DB seeds the chain and the task
 *  is locked for review until approved. */
export async function submitPlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) return { error: 'Task not found.' };

  const { data: subs } = await supabase
    .from('task_subtasks')
    .select('cost_cents, est_qty, est_unit, planned_start_date, is_variation')
    .eq('task_id', taskId);
  const baseline = ((subs ?? []) as {
    cost_cents: number | null;
    est_qty: number | null;
    est_unit: string | null;
    planned_start_date: string | null;
    is_variation: boolean;
  }[]).filter((s) => !s.is_variation);
  if (baseline.length === 0) return { error: 'Add at least one step to your plan first.' };
  const incomplete = baseline.some(
    (s) => (s.cost_cents ?? 0) <= 0 || !s.est_qty || s.est_qty <= 0 || !s.est_unit || !s.planned_start_date,
  );
  if (incomplete) {
    return { error: 'Every step needs a description, a duration, a start date and a cost before you can submit.' };
  }

  const { error } = await supabase
    .from('tasks')
    .update({ plan_submitted_at: new Date().toISOString() })
    .eq('id', taskId)
    .is('plan_approved_at', null);
  if (error) return { error: error.message };

  await logActivity(supabase, task, user.id, 'status', 'Submitted the plan + cost for approval');
  await notifyProjectManagers(supabase, {
    orgId: task.org_id,
    projectId: task.project_id,
    type: 'task_plan_submitted',
    title: 'Plan awaiting approval',
    body: `A priced plan for “${task.title}” needs your approval.`,
    link: `/projects/${task.project_id}/tasks/${taskId}`,
    entityId: taskId,
  });
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  return {};
}

export async function toggleSubtask(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const done = formData.get('done') === 'true';
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { error } = await supabase.from('task_subtasks').update({ is_done: done }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

export async function removeSubtask(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { error } = await supabase.from('task_subtasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
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

export async function raiseBlocker(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (!description) return { error: 'Describe the blocker.' };
  const task = await loadTask(supabase, taskId);
  if (!task) return { error: 'Task not found.' };
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
  if (error) return { error: error.message };
  await logActivity(supabase, task, user.id, 'blocker', `Blocker raised: ${description}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  return {};
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

/* ── Multi-contractor quotes (invite → submit → award) ───────────────────── */

/** PM invites one or more contractors to quote the task (blind bids). */
export async function inviteQuotes(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const contractorIds = formData.getAll('contractorIds').map(String).filter(Boolean);
  if (contractorIds.length === 0) throw new Error('Select at least one contractor');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  // Skip anyone already invited (unique task_id + contractor_id).
  const { data: existing } = await supabase
    .from('task_quotes')
    .select('contractor_id')
    .eq('task_id', taskId);
  const already = new Set(((existing ?? []) as { contractor_id: string }[]).map((e) => e.contractor_id));
  const rows = contractorIds
    .filter((id) => !already.has(id))
    .map((id) => ({
      org_id: task.org_id,
      project_id: task.project_id,
      task_id: taskId,
      contractor_id: id,
      status: 'invited' as const,
      created_by: user.id,
    }));
  if (rows.length === 0) throw new Error('Those contractors are already invited');

  const { error } = await supabase.from('task_quotes').insert(rows);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'quote', `Invited ${rows.length} contractor(s) to quote`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** Contractor submits (or declines) their own quote. RLS restricts this to their row. */
export async function submitQuote(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const decision = String(formData.get('decision') ?? ''); // submit | decline
  const task = await loadTask(supabase, taskId);
  if (!task) return { error: 'Task not found.' };

  const update: Record<string, unknown> = { decided_at: new Date().toISOString() };
  if (decision === 'decline') {
    update.status = 'declined';
  } else {
    const cost = Number(formData.get('costDollars') ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) return { error: 'Enter your cost for this task.' };
    update.status = 'submitted';
    update.submitted_at = new Date().toISOString();
    update.cost_cents = Math.round(cost * 100);
    update.proposed_start = (formData.get('proposedStart') as string) || null;
    update.proposed_end = (formData.get('proposedEnd') as string) || null;
    update.justification = (formData.get('justification') as string)?.trim() || null;
    const advancePct = Number(formData.get('advancePct') ?? 0);
    const retentionPct = Number(formData.get('retentionPct') ?? 0);
    update.payment_terms = {
      advancePct: advancePct > 0 ? advancePct : undefined,
      retentionPct: retentionPct > 0 ? retentionPct : undefined,
    };
  }

  const { error } = await supabase
    .from('task_quotes')
    .update(update)
    .eq('task_id', taskId)
    .eq('contractor_id', user.id);
  if (error) return { error: error.message };
  await logActivity(supabase, task, user.id, 'quote', decision === 'decline' ? 'Declined to quote' : 'Submitted a quote');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  return {};
}

/** PM awards a submitted quote: winner → awarded, rivals → not_selected (kept for
 *  audit), and the task is assigned to the winning contractor. The awarded quote's
 *  cost becomes the Earned-Value weight (read privileged, never exposed per-task). */
export async function awardQuote(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { data: quote } = await supabase
    .from('task_quotes')
    .select('contractor_id, status, cost_cents, payment_terms')
    .eq('id', quoteId)
    .maybeSingle();
  const winner = quote as
    | { contractor_id: string; status: string; cost_cents: number | null; payment_terms: unknown }
    | null;
  if (!winner) throw new Error('Quote not found');
  if (winner.status !== 'submitted') throw new Error('Only a submitted quote can be awarded');

  const now = new Date().toISOString();
  // Rivals first, then the winner, so a task never has two awarded rows.
  await supabase
    .from('task_quotes')
    .update({ status: 'not_selected', decided_at: now })
    .eq('task_id', taskId)
    .neq('id', quoteId);
  const { error } = await supabase
    .from('task_quotes')
    .update({ status: 'awarded', decided_at: now })
    .eq('id', quoteId);
  if (error) throw new Error(error.message);

  await supabase.from('tasks').update({ assignee_id: winner.contractor_id }).eq('id', taskId);

  await notifyUser(supabase, {
    orgId: task.org_id,
    userId: winner.contractor_id,
    type: 'quote_awarded',
    title: 'Quote awarded to you',
    body: `You won “${task.title}” — review and accept the task.`,
    link: `/projects/${task.project_id}/tasks/${taskId}`,
    entityId: taskId,
  });

  // Generate the contractor payment schedule from the awarded terms (once).
  const cost = winner.cost_cents ?? 0;
  if (cost > 0) {
    const { count: existing } = await supabase
      .from('payment_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId);
    if (!existing) {
      const terms = parsePaymentTerms(winner.payment_terms);
      const advance = terms.advancePct ? Math.round((cost * terms.advancePct) / 100) : 0;
      const retention = terms.retentionPct ? Math.round((cost * terms.retentionPct) / 100) : 0;
      const balance = cost - advance - retention;
      const base = { org_id: task.org_id, project_id: task.project_id, task_id: taskId, status: 'pending' as const };
      const draws: { name: string; amount_cents: number; kind: string }[] = [];
      if (advance > 0) draws.push({ name: `Advance (${terms.advancePct}%)`, amount_cents: advance, kind: 'advance' });
      if (balance > 0) draws.push({ name: 'On completion', amount_cents: balance, kind: 'completion' });
      if (retention > 0) draws.push({ name: `Retention (${terms.retentionPct}%)`, amount_cents: retention, kind: 'retention' });
      if (draws.length > 0) {
        await supabase.from('payment_schedule').insert(draws.map((d) => ({ ...base, ...d })));
      }
    }
  }

  await logActivity(supabase, task, user.id, 'quote', 'Awarded the quote — payment schedule generated');
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', task.org_id)
    .single();
  await emailUser(
    winner.contractor_id,
    quoteAwardedEmail({
      taskTitle: task.title,
      orgName: (org as { name?: string } | null)?.name ?? 'The client',
      url: `${appUrl()}/projects/${task.project_id}/tasks/${taskId}`,
    }),
  );
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/* ── Contractor payments ─────────────────────────────────────────────────── */

/** Mark a scheduled draw as paid (finance/PM). Optional payment reference. */
export async function markPaymentPaid(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const scheduleId = String(formData.get('scheduleId') ?? '');
  const reference = (formData.get('reference') as string)?.trim() || null;
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { error } = await supabase
    .from('payment_schedule')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paid_reference: reference })
    .eq('id', scheduleId)
    .eq('task_id', taskId);
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'payment', 'Recorded a contractor payment');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  revalidatePath('/payments');
}

/** Contractor raises a progress claim against their own pending draw
 *  ('pending' → 'invoiced'). The DB function enforces that only the assignee
 *  can claim, and only a pending draw. */
export async function submitPaymentClaim(formData: FormData) {
  const { supabase, user } = await requireUser();
  const scheduleId = String(formData.get('scheduleId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const note = (formData.get('note') as string)?.trim() || '';
  if (!scheduleId) throw new Error('Missing draw');

  const { error } = await supabase.rpc('submit_payment_claim', {
    p_schedule_id: scheduleId,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  const task = taskId ? await loadTask(supabase, taskId) : null;
  if (task) {
    await logActivity(supabase, task, user.id, 'payment', 'Submitted a payment claim');
    revalidatePath(`/projects/${task.project_id}/tasks/${task.id}`);
  }
  revalidatePath('/payments');
}

/** Finance/PM sends a claim back ('invoiced' → 'pending'). The DB function
 *  enforces that only finance or the project PM may reject. */
export async function rejectPaymentClaim(formData: FormData) {
  const { supabase, user } = await requireUser();
  const scheduleId = String(formData.get('scheduleId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  if (!scheduleId) throw new Error('Missing draw');

  const { error } = await supabase.rpc('reject_payment_claim', { p_schedule_id: scheduleId });
  if (error) throw new Error(error.message);

  const task = taskId ? await loadTask(supabase, taskId) : null;
  if (task) {
    await logActivity(supabase, task, user.id, 'payment', 'Rejected a payment claim');
    revalidatePath(`/projects/${task.project_id}/tasks/${task.id}`);
  }
  revalidatePath('/payments');
}

/* ── Task media (evidence, quotes) ───────────────────────────────────────── */

/** Record a file already uploaded to Storage by the browser client. */
export async function recordTaskMedia(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const storagePath = String(formData.get('storagePath') ?? '');
  const kind = String(formData.get('kind') ?? 'photo');
  const purpose = String(formData.get('purpose') ?? 'completion');
  const caption = (formData.get('caption') as string)?.trim() || null;
  if (!storagePath) throw new Error('No file uploaded');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { error } = await supabase.from('task_media').insert({
    org_id: task.org_id,
    project_id: task.project_id,
    task_id: taskId,
    subtask_id: (formData.get('subtaskId') as string) || null,
    kind,
    purpose,
    storage_path: storagePath,
    caption,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

export async function removeTaskMedia(formData: FormData) {
  const { supabase } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const mediaId = String(formData.get('mediaId') ?? '');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  const { error } = await supabase.from('task_media').delete().eq('id', mediaId).eq('task_id', taskId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/* ── Extension requests ──────────────────────────────────────────────────── */

/** Executor (assignee/contractor) asks for a new due date. */
export async function requestExtension(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const proposedDueDate = String(formData.get('proposedDueDate') ?? '');
  const reason = (formData.get('reason') as string)?.trim() || null;
  if (!proposedDueDate) return { error: 'Choose a proposed new due date.' };
  const task = await loadTask(supabase, taskId);
  if (!task) return { error: 'Task not found.' };

  const { error } = await supabase.from('task_extension_requests').insert({
    org_id: task.org_id,
    project_id: task.project_id,
    task_id: taskId,
    requested_by: user.id,
    proposed_due_date: proposedDueDate,
    reason,
  });
  if (error) return { error: error.message };
  await logActivity(supabase, task, user.id, 'extension', `Requested extension to ${proposedDueDate}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
  return {};
}

// decideExtension retired — extension approvals now run through the shared
// two-step chain (decideApprovalStep + finalize_approval).

// ── Tender by competing plans ────────────────────────────────────────────────
/** Invite more contractors to an open tender (each builds a competing plan). */
export async function inviteTenderContractors(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const contractorIds = [...new Set(formData.getAll('contractorIds').map(String).filter(Boolean))];
  if (contractorIds.length === 0) return;
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  await supabase.from('task_tender_invites').insert(
    contractorIds.map((cid) => ({
      org_id: task.org_id,
      project_id: task.project_id,
      task_id: taskId,
      contractor_id: cid,
      invited_by: user.id,
    })),
  );
  await logActivity(supabase, task, user.id, 'tender', `Invited ${contractorIds.length} contractor(s) to tender`);
  await Promise.all(
    contractorIds.map((cid) =>
      notifyUser(supabase, {
        orgId: task.org_id,
        userId: cid,
        type: 'tender_invited',
        title: 'Invited to tender',
        body: `You're invited to bid on “${task.title}” — build your plan and quote.`,
        link: `/projects/${task.project_id}/tasks/${taskId}`,
        entityId: taskId,
      }),
    ),
  );
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** Pull an invite (and that contractor's bid lines) before award. */
export async function withdrawTenderInvite(formData: FormData) {
  const { supabase } = await requireUser();
  const inviteId = String(formData.get('inviteId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { data: inv } = await supabase
    .from('task_tender_invites')
    .select('contractor_id')
    .eq('id', inviteId)
    .maybeSingle();
  const cid = (inv as { contractor_id: string } | null)?.contractor_id;
  await supabase.from('task_tender_invites').delete().eq('id', inviteId);
  if (cid) await supabase.from('task_subtasks').delete().eq('task_id', taskId).eq('bid_contractor_id', cid);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

/** Award the tender to a submitted bid — the winner's plan becomes the task's. */
export async function awardTender(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const winnerId = String(formData.get('winnerId') ?? '');
  if (!winnerId) throw new Error('Choose a winning bid');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');
  // Enrol the winner (assignee-is-a-member rule) before the atomic DB award.
  const enrolErr = await ensureProjectMember(supabase, task.org_id, task.project_id, winnerId);
  if (enrolErr) throw new Error(enrolErr);
  const { error } = await supabase.rpc('award_tender', { p_task_id: taskId, p_winner: winnerId });
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'tender', 'Awarded the tender');
  const { data: invites } = await supabase
    .from('task_tender_invites')
    .select('contractor_id, status')
    .eq('task_id', taskId);
  await Promise.all(
    ((invites ?? []) as { contractor_id: string; status: string }[]).map((i) =>
      notifyUser(supabase, {
        orgId: task.org_id,
        userId: i.contractor_id,
        type: i.status === 'awarded' ? 'tender_awarded' : 'tender_not_selected',
        title: i.status === 'awarded' ? 'You won the tender' : 'Tender result',
        body:
          i.status === 'awarded'
            ? `Your bid on “${task.title}” was accepted — the work is yours.`
            : `“${task.title}” was awarded to another contractor.`,
        link: `/projects/${task.project_id}/tasks/${taskId}`,
        entityId: taskId,
      }),
    ),
  );
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}
