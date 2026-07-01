import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { ProjectStatus, TaskPriority } from '@datumpro/shared/domain';
import type { RecentProject, UpcomingTask } from '@/lib/data/portfolio';

const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  planning: 'blue',
  active: 'green',
  on_hold: 'amber',
  completed: 'neutral',
  archived: 'neutral',
};

const PRIORITY_TONE: Record<TaskPriority, 'neutral' | 'amber'> = {
  urgent: 'amber',
  high: 'amber',
  medium: 'neutral',
  low: 'neutral',
};

export function RecentProjectsTable({ projects }: { projects: RecentProject[] }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>Recent projects</CardTitle>
        <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
          View all
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No projects yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center gap-3 py-2.5 hover:opacity-80"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  {p.clientName && <p className="truncate text-xs text-zinc-500">{p.clientName}</p>}
                </div>
                <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
                <div className="flex w-28 items-center gap-2">
                  <Progress value={p.progressPct} />
                  <span className="w-9 text-right text-xs tabular-nums text-zinc-500">
                    {p.progressPct}%
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function UpcomingTasksTable({ tasks }: { tasks: UpcomingTask[] }) {
  return (
    <Card>
      <CardTitle>Upcoming tasks</CardTitle>
      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No scheduled tasks due.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/projects/${t.projectId}/tasks/${t.id}`}
                className="flex items-center gap-3 py-2.5 hover:opacity-80"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {t.projectName}
                    {t.assigneeName ? ` · ${t.assigneeName}` : ''}
                  </p>
                </div>
                <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                <span className="w-24 text-right text-xs tabular-nums text-zinc-400">{t.dueDate}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
