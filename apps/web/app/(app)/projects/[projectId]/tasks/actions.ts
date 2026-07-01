'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTaskSchema } from '@datumpro/shared/validation';
import { parsePaymentTerms } from '@datumpro/shared/domain';
import { completionMediaCount } from '@/lib/data/quotes';

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
    .select(
      'id, org_id, project_id, status, due_date, sla_clock_paused_at, sla_total_paused_ms, requires_photo_on_complete',
    )
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
        requires_photo_on_complete: boolean;
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

  // Evidence gate: photo/video proof is mandatory unless the task opts out.
  if (task.requires_photo_on_complete && (await completionMediaCount(taskId)) === 0) {
    throw new Error('Attach at least one completion photo or video before submitting.');
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
export async function submitQuote(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const decision = String(formData.get('decision') ?? ''); // submit | decline
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const update: Record<string, unknown> = { decided_at: new Date().toISOString() };
  if (decision === 'decline') {
    update.status = 'declined';
  } else {
    const cost = Number(formData.get('costDollars') ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) throw new Error('Enter your cost for this task');
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
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'quote', decision === 'decline' ? 'Declined to quote' : 'Submitted a quote');
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
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
export async function requestExtension(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const proposedDueDate = String(formData.get('proposedDueDate') ?? '');
  const reason = (formData.get('reason') as string)?.trim() || null;
  if (!proposedDueDate) throw new Error('Choose a proposed new due date');
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { error } = await supabase.from('task_extension_requests').insert({
    org_id: task.org_id,
    project_id: task.project_id,
    task_id: taskId,
    requested_by: user.id,
    proposed_due_date: proposedDueDate,
    reason,
  });
  if (error) throw new Error(error.message);
  await logActivity(supabase, task, user.id, 'extension', `Requested extension to ${proposedDueDate}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}

/** PM approves (shifts the deadline → CPM recomputes) or rejects. */
export async function decideExtension(formData: FormData) {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const decision = String(formData.get('decision') ?? ''); // approve | reject
  const task = await loadTask(supabase, taskId);
  if (!task) throw new Error('Task not found');

  const { data: reqRow } = await supabase
    .from('task_extension_requests')
    .select('proposed_due_date')
    .eq('id', requestId)
    .maybeSingle();
  const proposed = (reqRow as { proposed_due_date: string } | null)?.proposed_due_date ?? null;

  const status = decision === 'approve' ? 'approved' : 'rejected';
  const { error } = await supabase
    .from('task_extension_requests')
    .update({ status, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('task_id', taskId);
  if (error) throw new Error(error.message);

  if (decision === 'approve' && proposed) {
    // Shift the working deadline; baseline stays frozen so variance is visible.
    await supabase
      .from('tasks')
      .update({ due_date: proposed, planned_end_date: proposed })
      .eq('id', taskId);
  }
  await logActivity(supabase, task, user.id, 'extension', `Extension ${status}`);
  revalidatePath(`/projects/${task.project_id}/tasks/${taskId}`);
}
