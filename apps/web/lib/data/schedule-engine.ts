import {
  addWorkingDays,
  computeSchedule,
  workingDaysBetween,
  type SchedTask,
  type WorkCalendar,
} from '@datumpro/shared/domain';
import type { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Statuses that mean a task has begun — pinned to their real start date so they
 *  don't float back to their CPM-earliest. */
const STARTED_STATUSES = new Set(['in_progress', 'submitted', 'done']);

/** Coerce a PostgREST numeric/string to a finite number, or `null`. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the working-day schedule for a project's tasks.
 *
 * Loads the project's org calendar, tasks, durations and dependencies, runs the
 * shared CPM engine (`computeSchedule`) to get earliest-start working-day offsets
 * honouring FS/SS/FF/SF + lag, then maps those offsets to real dates via the org
 * work calendar. Never backdates before today. Returns `[]` on a dependency cycle.
 */
export async function computeProjectPlan(
  supabase: SupabaseServerClient,
  projectId: string,
): Promise<{ id: string; start: string; end: string }[]> {
  const today = new Date().toISOString().slice(0, 10);

  // 1) Project — org + start floor (never before today).
  const { data: project } = await supabase
    .from('projects')
    .select('org_id, start_date')
    .eq('id', projectId)
    .single();
  if (!project) return [];

  const orgId = project.org_id as string;
  const rawStart = (project.start_date as string | null) ?? null;
  const projectStart = rawStart && rawStart > today ? rawStart : today;

  // 2) Work calendar — org's row, else Mon–Fri default; ZW public holidays.
  const { data: calRow } = await supabase
    .from('work_calendars')
    .select('works_sun, works_mon, works_tue, works_wed, works_thu, works_fri, works_sat')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  let workingDows: number[];
  if (calRow) {
    // JS getUTCDay: 0=Sun … 6=Sat.
    const flags: Array<[number, unknown]> = [
      [0, calRow.works_sun],
      [1, calRow.works_mon],
      [2, calRow.works_tue],
      [3, calRow.works_wed],
      [4, calRow.works_thu],
      [5, calRow.works_fri],
      [6, calRow.works_sat],
    ];
    workingDows = flags.filter(([, on]) => on === true).map(([dow]) => dow);
    if (workingDows.length === 0) workingDows = [1, 2, 3, 4, 5];
  } else {
    workingDows = [1, 2, 3, 4, 5];
  }

  const { data: holidayRows } = await supabase
    .from('public_holidays')
    .select('holiday_date')
    .eq('country', 'ZW');
  const holidays = (holidayRows ?? [])
    .map((h) => h.holiday_date as string)
    .filter((d): d is string => Boolean(d));

  const cal: WorkCalendar = { workingDows, holidays };

  // 3) Tasks — id, status, dates, agreed duration.
  const { data: taskRows } = await supabase
    .from('tasks')
    .select('id, status, planned_start_date, planned_end_date, due_date, agreed_duration_days')
    .eq('project_id', projectId);

  const tasks = taskRows ?? [];
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id as string);

  // 4) Dependencies — group by successor.
  const { data: depRows } = await supabase
    .from('task_dependencies')
    .select('predecessor_id, successor_id, lag_days, type')
    .in('successor_id', ids);

  const depsBySuccessor = new Map<string, SchedTask['dependencies']>();
  for (const d of depRows ?? []) {
    const successorId = d.successor_id as string;
    const list = depsBySuccessor.get(successorId) ?? [];
    list.push({
      predecessorId: d.predecessor_id as string,
      lagDays: num(d.lag_days) ?? 0,
      type: (d.type as SchedTask['dependencies'][number]['type']) ?? 'fs',
    });
    depsBySuccessor.set(successorId, list);
  }

  // Working-day duration per task.
  const durationOf = new Map<string, number>();
  const schedTasks: SchedTask[] = tasks.map((t) => {
    const id = t.id as string;
    const plannedStart = (t.planned_start_date as string | null) ?? null;
    const plannedEnd = (t.planned_end_date as string | null) ?? null;
    const dueDate = (t.due_date as string | null) ?? null;

    const agreed = num(t.agreed_duration_days);
    let duration: number;
    if (agreed !== null && agreed > 0) {
      duration = agreed;
    } else {
      const endDate = plannedEnd ?? dueDate;
      duration = plannedStart && endDate ? workingDaysBetween(plannedStart, endDate, cal) : 1;
    }
    durationOf.set(id, duration);

    // 5) Pin started tasks to their real start offset.
    let pinnedStartOffset: number | undefined;
    if (STARTED_STATUSES.has(t.status as string) && plannedStart) {
      pinnedStartOffset = Math.max(0, workingDaysBetween(projectStart, plannedStart, cal) - 1);
    }

    return {
      id,
      durationDays: duration,
      status: t.status as SchedTask['status'],
      weight: 1,
      dependencies: depsBySuccessor.get(id) ?? [],
      plannedStart,
      plannedEnd,
      pinnedStartOffset,
    };
  });

  // 6) Run the CPM engine.
  const result = computeSchedule(schedTasks);
  if (result.hasCycle) return [];

  // 7) Map offsets → working-day dates.
  return schedTasks.map((t) => {
    const es = result.tasks[t.id]?.es ?? 0;
    const start = addWorkingDays(projectStart, es, cal);
    const duration = durationOf.get(t.id) ?? 1;
    const end = addWorkingDays(start, Math.max(1, duration) - 1, cal);
    return { id: t.id, start, end };
  });
}
