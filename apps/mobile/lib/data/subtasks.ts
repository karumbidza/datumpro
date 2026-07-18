import { supabase } from '../supabase';

export interface Subtask {
  id: string;
  title: string;
  isDone: boolean;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  position: number;
}

export async function listSubtasks(taskId: string): Promise<Subtask[]> {
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, title, is_done, planned_start_date, planned_end_date, position')
    .eq('task_id', taskId)
    .order('position', { ascending: true });
  return ((data ?? []) as {
    id: string;
    title: string;
    is_done: boolean;
    planned_start_date: string | null;
    planned_end_date: string | null;
    position: number;
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    isDone: s.is_done,
    plannedStartDate: s.planned_start_date,
    plannedEndDate: s.planned_end_date,
    position: s.position,
  }));
}

export function subtaskPct(subs: Subtask[]): number {
  if (subs.length === 0) return 0;
  return Math.round((100 * subs.filter((s) => s.isDone).length) / subs.length);
}

/** done/total subtask counts for a set of tasks, keyed by task id — for the
 *  completion layer of the task-card progress bars. */
export async function subtaskProgressForTasks(
  taskIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const map = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return map;
  const { data } = await supabase.from('task_subtasks').select('task_id, is_done').in('task_id', taskIds);
  for (const s of ((data ?? []) as { task_id: string; is_done: boolean }[])) {
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
  const { error } = await supabase.from('task_subtasks').insert({
    org_id: params.orgId,
    task_id: params.taskId,
    title: params.title,
    planned_start_date: params.plannedStartDate ?? null,
    planned_end_date: params.plannedEndDate ?? null,
    position,
  });
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
