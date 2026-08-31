import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { listCalendarTasks, type CalendarTask } from '@/lib/data/project-calendar';
import { getProjectSchedule } from '@/lib/data/scheduling';
import type { ProgrammeData, ProgrammeTask, ProgrammeEdge, UnscheduledTask } from './programme-types';

export type {
  ProgrammeData,
  ProgrammeTask,
  ProgrammeEdge,
  UnscheduledTask,
} from './programme-types';

/** Resolve a task's bar window as ISO dates: the planned window, else a single
 *  due-day, else null (unscheduled). Mirrors the calendar's taskWindow. */
function resolveWindow(t: CalendarTask): { startIso: string; endIso: string; scheduled: boolean } | null {
  const start = t.planned_start_date;
  const end = t.planned_end_date ?? t.due_date;
  if (start && end) {
    // Guard against an end before the start (bad data) — clamp to a single day.
    return { startIso: start, endIso: end < start ? start : end, scheduled: true };
  }
  const due = t.due_date ?? end;
  if (due) return { startIso: due, endIso: due, scheduled: false };
  return null;
}

const EMPTY: ProgrammeData = {
  tasks: [],
  unscheduled: [],
  edges: [],
  rangeStartIso: null,
  rangeEndIso: null,
  projectStart: null,
  projectedFinish: null,
  baselineFinish: null,
  hasCycle: false,
  autoSchedule: false,
  baselinedAt: null,
};

/** Everything the programme/Gantt view needs: each task's bar window, the
 *  critical-path + float from the CPM engine, the dependency edges to draw, and
 *  the project start / projected-vs-baseline finish. RLS scopes the reads. */
export async function getProgrammeData(projectId: string): Promise<ProgrammeData> {
  const supabase = await createClient();
  const [calendarTasks, schedule, projectRes, orderRes] = await Promise.all([
    listCalendarTasks(projectId),
    getProjectSchedule(projectId),
    supabase.from('projects').select('auto_schedule, baselined_at').eq('id', projectId).maybeSingle(),
    supabase.from('tasks').select('id, programme_order, baseline_start_date, baseline_end_date').eq('project_id', projectId),
  ]);
  const projectRow = projectRes.data as { auto_schedule: boolean; baselined_at: string | null } | null;
  const autoSchedule = projectRow?.auto_schedule ?? false;
  const baselinedAt = projectRow?.baselined_at ?? null;
  const orderById = new Map<string, number>();
  const baselineById = new Map<string, { start: string | null; end: string | null }>();
  for (const r of (orderRes.data ?? []) as {
    id: string;
    programme_order: number | null;
    baseline_start_date: string | null;
    baseline_end_date: string | null;
  }[]) {
    if (r.programme_order != null) orderById.set(r.id, r.programme_order);
    if (r.baseline_start_date || r.baseline_end_date) baselineById.set(r.id, { start: r.baseline_start_date, end: r.baseline_end_date });
  }
  if (calendarTasks.length === 0) return { ...EMPTY, autoSchedule, baselinedAt };

  const tasks: ProgrammeTask[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const scheduledIds = new Set<string>();
  let rangeStartIso: string | null = null;
  let rangeEndIso: string | null = null;

  for (const t of calendarTasks) {
    const win = resolveWindow(t);
    if (!win) {
      unscheduled.push({ id: t.id, title: t.title, status: t.status });
      continue;
    }
    const meta = schedule?.meta[t.id];
    const base = baselineById.get(t.id);
    tasks.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assigneeName: t.assigneeName,
      startIso: win.startIso,
      endIso: win.endIso,
      baselineStartIso: base?.start ?? null,
      baselineEndIso: base?.end ?? null,
      scheduled: win.scheduled,
      critical: meta?.critical ?? false,
      floatDays: meta?.floatDays ?? 0,
      waitingOn: meta?.waitingOn ?? [],
    });
    scheduledIds.add(t.id);
    if (!rangeStartIso || win.startIso < rangeStartIso) rangeStartIso = win.startIso;
    if (!rangeEndIso || win.endIso > rangeEndIso) rangeEndIso = win.endIso;
    // Keep baseline ghosts inside the drawn range.
    if (base?.start && (!rangeStartIso || base.start < rangeStartIso)) rangeStartIso = base.start;
    if (base?.end && (!rangeEndIso || base.end > rangeEndIso)) rangeEndIso = base.end;
  }

  // Stable manual order (programme_order), falling back to start then title for
  // tasks not yet placed. Rows keep their position when a bar is rescheduled;
  // only an explicit drag-to-reorder changes programme_order.
  const orderOf = (id: string) => orderById.get(id) ?? Number.POSITIVE_INFINITY;
  tasks.sort(
    (a, b) =>
      orderOf(a.id) - orderOf(b.id) ||
      a.startIso.localeCompare(b.startIso) ||
      a.title.localeCompare(b.title),
  );

  // Dependency edges among the tasks we can draw.
  let edges: ProgrammeEdge[] = [];
  if (scheduledIds.size > 0) {
    const { data: depData } = await supabase
      .from('task_dependencies')
      .select('predecessor_id, successor_id, lag_days, type')
      .in('successor_id', [...scheduledIds]);
    // A link is a driving critical link when both ends are critical AND it is the
    // binding constraint on the successor (the relationship's implied anchor
    // equals the successor's earliest start/finish in the CPM layout).
    const sched = schedule?.schedule.tasks ?? {};
    const isDriving = (predId: string, succId: string, type: ProgrammeEdge['type'], lag: number): boolean => {
      const p = sched[predId];
      const s = sched[succId];
      if (!p || !s || !p.critical || !s.critical) return false;
      switch (type) {
        case 'ss':
          return s.es === p.es + lag;
        case 'ff':
          return s.ef === p.ef + lag;
        case 'sf':
          return s.ef === p.es + lag;
        default:
          return s.es === p.ef + lag; // fs
      }
    };
    edges = ((depData ?? []) as { predecessor_id: string; successor_id: string; lag_days: number; type: ProgrammeEdge['type'] | null }[])
      .filter((d) => scheduledIds.has(d.predecessor_id))
      .map((d) => {
        const type = d.type ?? 'fs';
        return {
          predecessorId: d.predecessor_id,
          successorId: d.successor_id,
          lagDays: d.lag_days,
          type,
          critical: isDriving(d.predecessor_id, d.successor_id, type, d.lag_days),
        };
      });
  }

  // Prefer the true captured baseline finish; fall back to the planned-derived one.
  let trueBaselineFinish: string | null = null;
  for (const t of tasks) {
    if (t.baselineEndIso && (!trueBaselineFinish || t.baselineEndIso > trueBaselineFinish)) trueBaselineFinish = t.baselineEndIso;
  }

  return {
    tasks,
    unscheduled,
    edges,
    rangeStartIso,
    rangeEndIso,
    projectStart: schedule?.projectStart ?? null,
    projectedFinish: schedule?.projectedFinish ?? null,
    baselineFinish: trueBaselineFinish ?? schedule?.baselineFinish ?? null,
    hasCycle: schedule?.schedule.hasCycle ?? false,
    autoSchedule,
    baselinedAt,
  };
}
