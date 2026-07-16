import { createClient } from '@/lib/supabase/server';

export interface Subtask {
  id: string;
  title: string;
  isDone: boolean;
  doneAt: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  position: number;
}

/** A task's subtask plan, in plan order. RLS scopes to project viewers. */
export async function listSubtasks(taskId: string): Promise<Subtask[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, title, is_done, done_at, planned_start_date, planned_end_date, position')
    .eq('task_id', taskId)
    .order('position', { ascending: true });
  return ((data ?? []) as {
    id: string;
    title: string;
    is_done: boolean;
    done_at: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    position: number;
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    isDone: s.is_done,
    doneAt: s.done_at,
    plannedStartDate: s.planned_start_date,
    plannedEndDate: s.planned_end_date,
    position: s.position,
  }));
}

/** Equal-weight completion %: done ÷ total (0 when there's no plan yet). */
export function subtaskProgress(subs: Subtask[]): number {
  if (subs.length === 0) return 0;
  return Math.round((100 * subs.filter((s) => s.isDone).length) / subs.length);
}

/** The project's overall % — average of its tasks' progress (subtask-driven;
 *  a done task counts 100). Single source of truth for the project bar. */
export async function getProjectProgress(projectId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('project_progress', { p_project_id: projectId });
  return typeof data === 'number' ? data : 0;
}

/** done/total subtask counts for a set of tasks, keyed by task id. */
export async function progressForTasks(
  taskIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const map = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.from('task_subtasks').select('task_id, is_done').in('task_id', taskIds);
  for (const s of (data ?? []) as { task_id: string; is_done: boolean }[]) {
    const e = map.get(s.task_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (s.is_done) e.done += 1;
    map.set(s.task_id, e);
  }
  return map;
}

/** A single task's % — done → 100; else subtask ratio; else the status stand-in
 *  (so tasks without a plan still read sensibly). Shared by the list + rollup. */
export function taskPct(
  status: string,
  entry: { done: number; total: number } | undefined,
  statusFallback: number,
): number {
  if (status === 'done') return 100;
  if (entry && entry.total > 0) return Math.round((100 * entry.done) / entry.total);
  return statusFallback;
}
