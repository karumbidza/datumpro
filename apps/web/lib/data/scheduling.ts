import { createClient } from '@/lib/supabase/server';
import {
  computeSchedule,
  computeProgress,
  inclusiveDays,
  type SchedTask,
  type ScheduleResult,
  type ProgressResult,
} from '@datumpro/shared/domain';
import type { TaskStatus } from '@datumpro/shared/domain';

export interface TaskScheduleMeta {
  critical: boolean;
  floatDays: number;
}

export interface ProjectSchedule {
  schedule: ScheduleResult;
  progress: ProgressResult;
  /** Per-task critical/float, keyed by task id. */
  meta: Record<string, TaskScheduleMeta>;
  projectStart: string | null;
  projectedFinish: string | null;
  baselineFinish: string | null;
  taskCount: number;
}

interface RawTask {
  id: string;
  status: TaskStatus;
  planned_start_date: string | null;
  planned_end_date: string | null;
  due_date: string | null;
  agreed_cost_cents: number | null;
}

function taskDuration(t: RawTask): number {
  if (t.planned_start_date && t.planned_end_date) return inclusiveDays(t.planned_start_date, t.planned_end_date);
  if (t.planned_start_date && t.due_date) return inclusiveDays(t.planned_start_date, t.due_date);
  return 1;
}

/** Earned-Value weight: the agreed contractor cost once a commitment is locked,
 *  otherwise planned duration. Cost-weighting is the industry standard; duration
 *  is the honest fallback before a price exists. */
function taskWeight(t: RawTask, duration: number): number {
  return t.agreed_cost_cents && t.agreed_cost_cents > 0 ? t.agreed_cost_cents : duration;
}

/** Run the CPM + earned-value engine over one project's tasks & dependencies.
 *  RLS scopes the reads. Returns null when the project has no tasks. */
export async function getProjectSchedule(projectId: string): Promise<ProjectSchedule | null> {
  const supabase = await createClient();

  const { data: taskData } = await supabase
    .from('tasks')
    .select('id, status, planned_start_date, planned_end_date, due_date, agreed_cost_cents')
    .eq('project_id', projectId);
  const tasks = (taskData ?? []) as RawTask[];
  if (tasks.length === 0) return null;

  const ids = tasks.map((t) => t.id);
  const { data: depData } = await supabase
    .from('task_dependencies')
    .select('predecessor_id, successor_id, lag_days')
    .in('successor_id', ids);

  const depsBySuccessor = new Map<string, { predecessorId: string; lagDays: number }[]>();
  for (const d of (depData ?? []) as { predecessor_id: string; successor_id: string; lag_days: number }[]) {
    const list = depsBySuccessor.get(d.successor_id) ?? [];
    list.push({ predecessorId: d.predecessor_id, lagDays: d.lag_days });
    depsBySuccessor.set(d.successor_id, list);
  }

  const sched: SchedTask[] = tasks.map((t) => {
    const duration = taskDuration(t);
    return {
      id: t.id,
      durationDays: duration,
      status: t.status,
      weight: taskWeight(t, duration),
      dependencies: depsBySuccessor.get(t.id) ?? [],
      plannedStart: t.planned_start_date,
      plannedEnd: t.planned_end_date ?? t.due_date,
    };
  });

  const schedule = computeSchedule(sched);
  const progress = computeProgress(sched);

  const meta: Record<string, TaskScheduleMeta> = {};
  for (const id of ids) {
    const s = schedule.tasks[id];
    meta[id] = { critical: s?.critical ?? false, floatDays: s?.float ?? 0 };
  }

  const starts = tasks
    .map((t) => t.planned_start_date)
    .filter((d): d is string => !!d)
    .sort();
  const projectStart = starts[0] ?? null;

  const ends = tasks
    .map((t) => t.planned_end_date ?? t.due_date)
    .filter((d): d is string => !!d)
    .sort();
  const baselineFinish = ends.length ? ends[ends.length - 1]! : null;

  let projectedFinish: string | null = null;
  if (projectStart && !schedule.hasCycle) {
    const d = new Date(projectStart);
    d.setDate(d.getDate() + schedule.projectDurationDays);
    projectedFinish = d.toISOString().slice(0, 10);
  }

  return {
    schedule,
    progress,
    meta,
    projectStart,
    projectedFinish,
    baselineFinish,
    taskCount: tasks.length,
  };
}
