import { supabase } from '../supabase';

export interface Subtask {
  id: string;
  title: string;
  isDone: boolean;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  position: number;
  costCents: number;
  estQty: number | null;
  estUnit: 'hours' | 'days' | null;
  isVariation: boolean;
  /** null for baseline plan lines; pending|approved|rejected for variations. */
  variationStatus: 'pending' | 'approved' | 'rejected' | null;
}

/** A subtask counts toward the agreed scope (progress + cost) if it's a baseline
 *  line or an APPROVED variation. Pending/rejected variations don't count. */
export function isCounted(s: Subtask): boolean {
  return !s.isVariation || s.variationStatus === 'approved';
}

export async function listSubtasks(taskId: string): Promise<Subtask[]> {
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, title, is_done, planned_start_date, planned_end_date, position, cost_cents, est_qty, est_unit, is_variation, variation_status')
    .eq('task_id', taskId)
    .order('position', { ascending: true });
  return ((data ?? []) as {
    id: string;
    title: string;
    is_done: boolean;
    planned_start_date: string | null;
    planned_end_date: string | null;
    position: number;
    cost_cents: number | null;
    est_qty: number | null;
    est_unit: 'hours' | 'days' | null;
    is_variation: boolean;
    variation_status: 'pending' | 'approved' | 'rejected' | null;
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    isDone: s.is_done,
    plannedStartDate: s.planned_start_date,
    plannedEndDate: s.planned_end_date,
    position: s.position,
    costCents: s.cost_cents ?? 0,
    estQty: s.est_qty,
    estUnit: s.est_unit,
    isVariation: s.is_variation,
    variationStatus: s.variation_status,
  }));
}

export function subtaskPct(subs: Subtask[]): number {
  const counted = subs.filter(isCounted);
  if (counted.length === 0) return 0;
  return Math.round((100 * counted.filter((s) => s.isDone).length) / counted.length);
}

/** done/total subtask counts for a set of tasks, keyed by task id — for the
 *  completion layer of the task-card progress bars. */
export async function subtaskProgressForTasks(
  taskIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const map = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return map;
  const { data } = await supabase
    .from('task_subtasks')
    .select('task_id, is_done, is_variation, variation_status')
    .in('task_id', taskIds);
  for (const s of ((data ?? []) as {
    task_id: string;
    is_done: boolean;
    is_variation: boolean;
    variation_status: string | null;
  }[])) {
    // Only the agreed scope counts: baseline lines + approved variations.
    if (s.is_variation && s.variation_status !== 'approved') continue;
    const e = map.get(s.task_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (s.is_done) e.done += 1;
    map.set(s.task_id, e);
  }
  return map;
}

export async function acceptTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ acceptance_status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
}

export async function declineTask(taskId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ acceptance_status: 'rejected', rejected_reason: reason || null, assignee_id: null })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
}

/** Hand an already-accepted task back to the PM (any time before submit). */
export async function returnTask(taskId: string, reason: string): Promise<void> {
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
}

export async function addSubtask(params: {
  taskId: string;
  orgId: string;
  title: string;
  costCents?: number;
  estQty?: number | null;
  estUnit?: 'hours' | 'days' | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}): Promise<void> {
  const { data: last } = await supabase
    .from('task_subtasks')
    .select('position')
    .eq('task_id', params.taskId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;
  // is_variation / variation_status are set by the DB from the task's plan state.
  const { error } = await supabase.from('task_subtasks').insert({
    org_id: params.orgId,
    task_id: params.taskId,
    title: params.title,
    cost_cents: Math.max(0, Math.round(params.costCents ?? 0)),
    est_qty: params.estQty ?? null,
    est_unit: params.estUnit ?? null,
    planned_start_date: params.plannedStartDate ?? null,
    planned_end_date: params.plannedEndDate ?? null,
    position,
  });
  if (error) throw new Error(error.message);
}

export async function updateSubtask(
  id: string,
  patch: {
    title?: string;
    costCents?: number;
    estQty?: number | null;
    estUnit?: 'hours' | 'days' | null;
    plannedStartDate?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.costCents !== undefined) row.cost_cents = Math.max(0, Math.round(patch.costCents));
  if (patch.estQty !== undefined) row.est_qty = patch.estQty;
  if (patch.estUnit !== undefined) row.est_unit = patch.estUnit;
  if (patch.plannedStartDate !== undefined) row.planned_start_date = patch.plannedStartDate;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('task_subtasks').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Contractor submits the priced plan for PM→Admin approval. Every baseline line
 *  needs a cost, a duration and a start date; the DB then seeds the chain and the
 *  task is locked for review until approved. */
export async function submitPlan(taskId: string): Promise<void> {
  const subs = await listSubtasks(taskId);
  const baseline = subs.filter((s) => !s.isVariation);
  if (baseline.length === 0) throw new Error('Add at least one step to your plan first.');
  const incomplete = baseline.find(
    (s) => s.costCents <= 0 || !s.estQty || s.estQty <= 0 || !s.estUnit || !s.plannedStartDate,
  );
  if (incomplete) {
    throw new Error('Every step needs a description, a duration, a start date and a cost before you can submit.');
  }
  const { error } = await supabase
    .from('tasks')
    .update({ plan_submitted_at: new Date().toISOString() })
    .eq('id', taskId)
    .is('plan_approved_at', null);
  if (error) throw new Error(error.message);
}

export async function toggleSubtask(id: string, done: boolean): Promise<void> {
  const { error } = await supabase.from('task_subtasks').update({ is_done: done }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removeSubtask(id: string): Promise<void> {
  const { error } = await supabase.from('task_subtasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
