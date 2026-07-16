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
