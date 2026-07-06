import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listTasksByProject, listOrgMembers, type TaskRow } from '@/lib/data/tasks';
import { getProjectSchedule, type ProjectSchedule } from '@/lib/data/scheduling';
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

/** Derive a 0–100 completion percent from status + planned window. There's no
 *  stored per-task percent, so done = 100, todo = 0, and in-flight tasks read
 *  how far into their planned window "now" sits (falling back to sensible
 *  midpoints when a task is undated). */
function taskPercent(t: TaskRow): number {
  if (t.status === 'done') return 100;
  if (t.status === 'todo') return 0;
  const start = parseDate(t.planned_start_date);
  const end = parseDate(t.planned_end_date ?? t.due_date);
  if (start && end && end.getTime() > start.getTime()) {
    const frac = (Date.now() - start.getTime()) / (end.getTime() - start.getTime());
    return Math.round(Math.min(1, Math.max(0, frac)) * 100);
  }
  if (t.status === 'submitted') return 90;
  if (t.status === 'blocked') return 40;
  return 50;
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const [tasks, schedule, members] = await Promise.all([
    listTasksByProject(projectId),
    getProjectSchedule(projectId),
    listOrgMembers(project.org_id),
  ]);
  const nameById = new Map(members.map((m) => [m.userId, m.name]));

  return (
    <main className="mx-auto flex max-w-[1152px] flex-col gap-8 px-10 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
            ← {project.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tasks</h1>
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
              const pct = taskPercent(t);
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
                    <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="absolute left-0 top-0 h-2 rounded-full"
                        style={{ width: `${pct}%`, background: status.fill }}
                      />
                    </div>
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
