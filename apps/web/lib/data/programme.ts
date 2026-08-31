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
};

/** Everything the programme/Gantt view needs: each task's bar window, the
 *  critical-path + float from the CPM engine, the dependency edges to draw, and
 *  the project start / projected-vs-baseline finish. RLS scopes the reads. */
export async function getProgrammeData(projectId: string): Promise<ProgrammeData> {
  const supabase = await createClient();
  const [calendarTasks, schedule, projectRes] = await Promise.all([
    listCalendarTasks(projectId),
    getProjectSchedule(projectId),
    supabase.from('projects').select('auto_schedule').eq('id', projectId).maybeSingle(),
  ]);
  const autoSchedule = ((projectRes.data as { auto_schedule: boolean } | null)?.auto_schedule) ?? false;
  if (calendarTasks.length === 0) return { ...EMPTY, autoSchedule };

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
    tasks.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assigneeName: t.assigneeName,
      startIso: win.startIso,
      endIso: win.endIso,
      scheduled: win.scheduled,
      critical: meta?.critical ?? false,
      floatDays: meta?.floatDays ?? 0,
      waitingOn: meta?.waitingOn ?? [],
    });
    scheduledIds.add(t.id);
    if (!rangeStartIso || win.startIso < rangeStartIso) rangeStartIso = win.startIso;
    if (!rangeEndIso || win.endIso > rangeEndIso) rangeEndIso = win.endIso;
  }

  // Sort by start, then critical first, then title — a readable programme order.
  tasks.sort(
    (a, b) =>
      a.startIso.localeCompare(b.startIso) ||
      Number(b.critical) - Number(a.critical) ||
      a.title.localeCompare(b.title),
  );

  // Dependency edges among the tasks we can draw.
  let edges: ProgrammeEdge[] = [];
  if (scheduledIds.size > 0) {
    const supabase = await createClient();
    const { data: depData } = await supabase
      .from('task_dependencies')
      .select('predecessor_id, successor_id, lag_days')
      .in('successor_id', [...scheduledIds]);
    edges = ((depData ?? []) as { predecessor_id: string; successor_id: string; lag_days: number }[])
      .filter((d) => scheduledIds.has(d.predecessor_id))
      .map((d) => ({ predecessorId: d.predecessor_id, successorId: d.successor_id, lagDays: d.lag_days }));
  }

  return {
    tasks,
    unscheduled,
    edges,
    rangeStartIso,
    rangeEndIso,
    projectStart: schedule?.projectStart ?? null,
    projectedFinish: schedule?.projectedFinish ?? null,
    baselineFinish: schedule?.baselineFinish ?? null,
    hasCycle: schedule?.schedule.hasCycle ?? false,
    autoSchedule,
  };
}
