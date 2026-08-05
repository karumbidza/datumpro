import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_TONE } from '@/components/ui/tones';
import { TASK_PRIORITY_LABELS } from '@datumpro/shared/domain';
import { formatShortDate } from '@/lib/date';
import type { UpcomingTask } from '@/lib/data/portfolio';

export function UpcomingTasksTable({ tasks }: { tasks: UpcomingTask[] }) {
  return (
    <Card>
      <CardTitle>Upcoming tasks</CardTitle>
      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No scheduled tasks due.</p>
      ) : (
        <ul className="mt-2">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/projects/${t.projectId}/tasks/${t.id}`}
                className="flex items-center gap-3 border-b border-zinc-100 py-2.5 last:border-b-0 hover:opacity-80 dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {t.projectName}
                    {t.assigneeName ? ` · ${t.assigneeName}` : ''}
                  </p>
                </div>
                <Badge tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABELS[t.priority]}</Badge>
                <span className="w-24 text-right text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                  {formatShortDate(t.dueDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
