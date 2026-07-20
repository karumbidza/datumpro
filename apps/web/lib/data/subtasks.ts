import { createClient } from '@/lib/supabase/server';

export interface Subtask {
  id: string;
  title: string;
  isDone: boolean;
  doneAt: string | null;
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
export function isCounted(s: Pick<Subtask, 'isVariation' | 'variationStatus'>): boolean {
  return !s.isVariation || s.variationStatus === 'approved';
}

/** A task's subtask plan, in plan order. RLS scopes to project viewers. */
export async function listSubtasks(taskId: string): Promise<Subtask[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, title, is_done, done_at, planned_start_date, planned_end_date, position, cost_cents, est_qty, est_unit, is_variation, variation_status')
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
    cost_cents: number | null;
    est_qty: number | null;
    est_unit: 'hours' | 'days' | null;
    is_variation: boolean;
    variation_status: 'pending' | 'approved' | 'rejected' | null;
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    isDone: s.is_done,
    doneAt: s.done_at,
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

/** Equal-weight completion % across the agreed scope (0 when there's no plan). */
export function subtaskProgress(subs: Subtask[]): number {
  const counted = subs.filter(isCounted);
  if (counted.length === 0) return 0;
  return Math.round((100 * counted.filter((s) => s.isDone).length) / counted.length);
}

/** The project's overall % — an effort-weighted roll-up of its tasks' progress
 *  (subtask-driven; a done task counts 100), where each task is weighted by its
 *  awarded contract value so big packages move the bar more than small ones. See
 *  the project_progress SQL function. Single source of truth for the project bar. */
export async function getProjectProgress(projectId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('project_progress', { p_project_id: projectId });
  return typeof data === 'number' ? data : 0;
}

export type ProgressPoint = { day: string; pct: number };

/** The project's recent burn-up: one point per captured day (oldest → newest),
 *  from the nightly snapshot cron. Empty until the first snapshot lands. */
export async function getProgressHistory(projectId: string, days = 30): Promise<ProgressPoint[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('project_progress_snapshots')
    .select('day, pct')
    .eq('project_id', projectId)
    .gte('day', since)
    .order('day', { ascending: true });
  return (data ?? []) as ProgressPoint[];
}

/** done/total subtask counts for a set of tasks, keyed by task id. */
export async function progressForTasks(
  taskIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const map = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_subtasks')
    .select('task_id, is_done, is_variation, variation_status')
    .in('task_id', taskIds);
  for (const s of (data ?? []) as {
    task_id: string;
    is_done: boolean;
    is_variation: boolean;
    variation_status: string | null;
  }[]) {
    // Only the agreed scope counts: baseline lines + approved variations.
    if (s.is_variation && s.variation_status !== 'approved') continue;
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
