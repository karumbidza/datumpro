import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listTasksByProject, listOrgMembers, type TaskRow } from '@/lib/data/tasks';
import { getProjectSchedule, type ProjectSchedule } from '@/lib/data/scheduling';
import { progressForTasks, getProjectProgress } from '@/lib/data/subtasks';
import { Button } from '@/components/ui/button';
import { ChevronRight } from '@/components/icons';
import { parseDate, formatDayMonth } from '@/lib/date';
import type { TaskStatus, TaskPriority } from '@datumpro/shared/domain';

const GRID_TEMPLATE = '170px minmax(150px,1fr) 44px 64px 104px 16px';
const GRID_STYLE = { gridTemplateColumns: GRID_TEMPLATE, gap: '14px' } as const;
const PILL = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';

const STATUS_META: Record<TaskStatus, { label: string; pill: string; fill: string }> = {
  done: {
    label: 'Done',
    pill: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400',
    fill: '#16a34a',
  },
  in_progress: {
    label: 'In progress',
    pill: 'bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-500',
    fill: '#2563eb',
  },
  submitted: {
    label: 'Review',
    pill: 'bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-500',
    fill: '#3b82f6',
  },
  blocked: {
    label: 'Blocked',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    fill: '#d97706',
  },
  todo: {
    label: 'To do',
    pill: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    fill: '#d4d4d8',
  },
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  urgent: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  high: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  medium: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** ACTUAL completion — real work done, never time-based. Done = 100, submitted =
 *  100 (delivered, in review), otherwise the ticked share of the subtask plan;
 *  a task with no plan reads 0 until steps are ticked. This drives the % and the
 *  green bar. */
function actualPercent(t: TaskRow, entry?: { done: number; total: number }): number {
  if (t.status === 'done') return 100;
  if (entry && entry.total > 0) return Math.round((100 * entry.done) / entry.total);
  if (t.status === 'submitted') return 100;
  return 0;
}

/** EXPECTED position — how far into the planned window "now" sits (0 before it
 *  starts, 100 after it ends). This is the faint "where it should be" bar; null
 *  when there's no window to measure against. */
function expectedFromWindow(start: Date | null, end: Date | null): number | null {
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  const frac = (Date.now() - start.getTime()) / (end.getTime() - start.getTime());
  return Math.round(Math.min(1, Math.max(0, frac)) * 100);
}
function taskExpected(t: TaskRow): number | null {
  if (t.status === 'done') return null;
  return expectedFromWindow(parseDate(t.planned_start_date), parseDate(t.planned_end_date ?? t.due_date));
}

/** Planned-vs-actual rail: a faint fill for where the schedule says we should be,
 *  a solid completion fill on top (green on/ahead of schedule, amber when behind),
 *  and a hairline marker at the on-schedule target. */
function ScheduleBar({ actual, expected, done }: { actual: number; expected: number | null; done?: boolean }) {
  const behind = !done && expected != null && actual < expected - 1;
  const fill = done ? '#16a34a' : behind ? '#f59e0b' : '#10b981';
  return (
    <div
      className="relative h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      title={expected != null ? `${actual}% done · on-schedule target ${expected}%` : `${actual}% done`}
    >
      {expected != null && (
        <div
          className="absolute left-0 top-0 h-2 bg-zinc-300/70 dark:bg-zinc-600/60"
          style={{ width: `${expected}%` }}
        />
      )}
      <div className="absolute left-0 top-0 h-2 rounded-full" style={{ width: `${actual}%`, background: fill }} />
      {expected != null && expected > 0 && expected < 100 && (
        <div
          className="absolute top-0 h-2 w-px bg-zinc-500/70 dark:bg-zinc-300/70"
          style={{ left: `${expected}%` }}
        />
      )}
    </div>
  );
}

/** The small coloured line under the progress rail. Priority: signed-off →
 *  blocked → critical path → in review → slack/neutral. */
function statusNote(
  t: TaskRow,
  schedule: ProjectSchedule | null,
): { text: string; className: string } {
  if (t.status === 'done') return { text: '✓ Signed off', className: 'text-green-600 dark:text-green-400' };
  if (t.status === 'blocked') {
    return {
      text: `🚧 ${t.blocker_description?.trim() || 'Blocked'}`,
      className: 'text-amber-600 dark:text-amber-400',
    };
  }
  const meta = schedule?.meta[t.id];
  if (meta?.critical) return { text: '● Critical path', className: 'text-red-600 dark:text-red-400' };
  if (t.status === 'submitted') return { text: 'In review', className: 'text-zinc-400' };
  if (meta && meta.floatDays > 0) return { text: `${meta.floatDays}d slack`, className: 'text-zinc-400' };
  return { text: 'In progress', className: 'text-zinc-400' };
}

export default async function TaskBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const [tasks, schedule, members] = await Promise.all([
    listTasksByProject(projectId),
    getProjectSchedule(projectId),
    listOrgMembers(project.org_id),
  ]);
  const nameById = new Map(members.map((m) => [m.userId, m.name]));
  const [progress, projectPct] = await Promise.all([
    progressForTasks(tasks.map((t) => t.id)),
    getProjectProgress(projectId),
  ]);

  // The project's on-schedule target: how far into its overall window (earliest
  // task start → latest task end) "now" sits.
  const projStart = tasks.reduce<string | null>(
    (m, t) => (t.planned_start_date && (!m || t.planned_start_date < m) ? t.planned_start_date : m),
    null,
  );
  const projEnd = tasks.reduce<string | null>((m, t) => {
    const e = t.planned_end_date ?? t.due_date;
    return e && (!m || e > m) ? e : m;
  }, null);
  const projectExpected = expectedFromWindow(
    projStart ? parseDate(projStart) : null,
    projEnd ? parseDate(projEnd) : null,
  );

  return (
    <main className="mx-auto flex max-w-[1152px] flex-col gap-8 px-10 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
            ← {project.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tasks</h1>
          {tasks.length > 0 && (
            <>
              <div className="mt-2 flex items-center gap-2">
                <div className="w-40">
                  <ScheduleBar actual={projectPct} expected={projectExpected} />
                </div>
                <span className="text-xs font-medium tabular-nums text-zinc-500">{projectPct}% complete</span>
                {projectExpected != null && (
                  <span className="text-[11px] tabular-nums text-zinc-400">
                    · target {projectExpected}%
                    {projectPct < projectExpected - 1 ? ' (behind)' : ''}
                  </span>
                )}
              </div>
              {/* Legend for the two-layer bars */}
              <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Completed
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-zinc-300 dark:bg-zinc-600" /> Should be (schedule)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-amber-500" /> Behind
                </span>
              </div>
            </>
          )}
        </div>
        <Link href={`/projects/${projectId}/tasks/new`}>
          <Button>New task</Button>
        </Link>
      </header>

      {tasks.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No tasks yet — create the first one.
        </p>
      ) : (
        <div>
          {/* Header row — shares the grid template so columns align with rows. */}
          <div
            className="grid items-center px-4 pb-2 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400"
            style={GRID_STYLE}
          >
            <div>Task / assignee</div>
            <div>Progress</div>
            <div className="text-right">%</div>
            <div className="text-center">Priority</div>
            <div className="text-center">Status</div>
            <div />
          </div>

          <div className="flex flex-col gap-2">
            {tasks.map((t) => {
              const status = STATUS_META[t.status];
              const pct = actualPercent(t, progress.get(t.id));
              const expected = taskExpected(t);
              const note = statusNote(t, schedule);
              const assignee = t.assignee_id ? nameById.get(t.assignee_id) ?? 'Member' : 'Unassigned';
              const due = parseDate(t.due_date);
              return (
                <Link
                  key={t.id}
                  href={`/projects/${projectId}/tasks/${t.id}`}
                  className="grid cursor-pointer items-center rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                  style={GRID_STYLE}
                >
                  {/* Task / assignee */}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {t.title}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{assignee}</p>
                  </div>

                  {/* Progress */}
                  <div className="min-w-0">
                    <ScheduleBar actual={pct} expected={expected} done={t.status === 'done'} />
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                      <span className={`truncate ${note.className}`}>{note.text}</span>
                      <span className="flex-shrink-0 text-zinc-400">
                        {due ? `Due ${formatDayMonth(due)}` : 'No due date'}
                      </span>
                    </div>
                  </div>

                  {/* % */}
                  <div className="text-right text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {pct}%
                  </div>

                  {/* Priority */}
                  <div className="flex justify-center">
                    <span className={`${PILL} ${PRIORITY_PILL[t.priority]}`}>
                      {PRIORITY_LABEL[t.priority]}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex justify-center">
                    <span className={`${PILL} ${status.pill}`}>{status.label}</span>
                  </div>

                  {/* Chevron */}
                  <ChevronRight size={16} className="text-zinc-300 dark:text-zinc-600" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
