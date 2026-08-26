import Link from 'next/link';
import { dotClass, relativeTime } from './activity-format';
import type { ProjectActivityRow } from '@/lib/data/tasks';

/* Slim, timeline-style preview of the latest events — a light companion to the
 * Gantt, deliberately not a bordered card. The full log lives behind "View all". */
export function ActivityPreview({
  items,
  projectId,
}: {
  items: ProjectActivityRow[];
  projectId: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">No recent activity yet.</p>
    );
  }

  return (
    <ol className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-[5.5px] top-3 w-px bg-zinc-200 dark:bg-zinc-800"
      />
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/projects/${projectId}/tasks/${item.taskId}`}
            className="group flex items-center gap-2.5 rounded-md py-1.5 pr-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
          >
            <span className="relative z-10 flex w-3 shrink-0 justify-center">
              <span
                className={`h-[7px] w-[7px] rounded-full ring-2 ring-white dark:ring-zinc-950 ${dotClass(item.type)}`}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.taskTitle}</span>
              <span className="text-zinc-400 dark:text-zinc-600"> · </span>
              <span className="text-zinc-500 dark:text-zinc-400">{item.message}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
              {relativeTime(item.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
