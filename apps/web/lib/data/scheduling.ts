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
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';

export interface TaskScheduleMeta {
  critical: boolean;
  floatDays: number;
  /** Titles of predecessor tasks that aren't done yet — non-empty ⇒ blocked. */
  waitingOn: string[];
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
  org_id: string;
  title: string;
  status: TaskStatus;
  planned_start_date: string | null;
  planned_end_date: string | null;
  due_date: string | null;
}

function taskDuration(t: RawTask): number {
  if (t.planned_start_date && t.planned_end_date) return inclusiveDays(t.planned_start_date, t.planned_end_date);
  if (t.planned_start_date && t.due_date) return inclusiveDays(t.planned_start_date, t.due_date);
  return 1;
}

/** Run the CPM + earned-value engine over one project's tasks & dependencies.
 *  RLS scopes the reads. Returns null when the project has no tasks. */
export async function getProjectSchedule(projectId: string): Promise<ProjectSchedule | null> {
  const supabase = await createClient();

  const { data: taskData } = await supabase
    .from('tasks')
    .select('id, org_id, title, status, planned_start_date, planned_end_date, due_date')
    .eq('project_id', projectId);
  const tasks = (taskData ?? []) as RawTask[];
  if (tasks.length === 0) return null;

  const orgId = tasks[0]!.org_id;
  const ids = tasks.map((t) => t.id);
  const { data: depData } = await supabase
    .from('task_dependencies')
    .select('predecessor_id, successor_id, lag_days')
    .in('successor_id', ids);

  // Cost-weighted Earned Value only for viewers allowed to see costs (staff / the
  // project PM). Others get honest duration-weighting — never a peer's price.
  const [orgRole, projectRoleValue] = await Promise.all([myOrgRole(orgId), myProjectRole(projectId)]);
  const privileged =
    orgRole === 'owner' || orgRole === 'admin' || orgRole === 'finance' || projectRoleValue === 'pm';

  const costByTask = new Map<string, number>();
  if (privileged) {
    const { data: awarded } = await supabase
      .from('task_quotes')
      .select('task_id, cost_cents')
      .eq('project_id', projectId)
      .eq('status', 'awarded');
    for (const q of (awarded ?? []) as { task_id: string; cost_cents: number | null }[]) {
      if (q.cost_cents && q.cost_cents > 0) costByTask.set(q.task_id, q.cost_cents);
    }
  }

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
      weight: costByTask.get(t.id) ?? duration,
      dependencies: depsBySuccessor.get(t.id) ?? [],
      plannedStart: t.planned_start_date,
      plannedEnd: t.planned_end_date ?? t.due_date,
    };
  });

  const schedule = computeSchedule(sched);
  const progress = computeProgress(sched);

  // A task is blocked while any predecessor isn't done — surface which ones.
  const titleById = new Map(tasks.map((t) => [t.id, t.title]));
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));

  const meta: Record<string, TaskScheduleMeta> = {};
  for (const id of ids) {
    const s = schedule.tasks[id];
    const waitingOn = (depsBySuccessor.get(id) ?? [])
      .filter((d) => statusById.get(d.predecessorId) !== 'done')
      .map((d) => titleById.get(d.predecessorId) ?? 'a task');
    meta[id] = { critical: s?.critical ?? false, floatDays: s?.float ?? 0, waitingOn };
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
