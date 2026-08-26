import Link from 'next/link';
import { Activity, Clock } from '@/components/icons';
import type { ProjectActivityRow } from '@/lib/data/tasks';

/* Tone per activity type — the audit trail's own colour language. */
const TYPE_TONE: Record<string, string> = {
  created: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  assigned: 'bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-500',
  status: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  blocker: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  done: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function RecentActivity({ items, projectId }: { items: ProjectActivityRow[]; projectId: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Activity size={16} className="text-zinc-900 dark:text-white" />
        <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Recent Activity</h3>
      </div>

      {items.length === 0 ? (
        <div className="p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <Clock size={24} className="text-zinc-500 dark:text-zinc-400" />
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No recent activity</p>
        </div>
      ) : (
        <div className="max-h-[26rem] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/projects/${projectId}/tasks/${item.taskId}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
              <div className="mt-0.5 rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                <Activity size={14} className="text-zinc-500 dark:text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {item.taskTitle}
                  </p>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium capitalize ${
                      TYPE_TONE[item.type] ?? TYPE_TONE.created
                    }`}
                  >
                    {item.type.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{item.message}</p>
                <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200">
                      {item.userName[0]?.toUpperCase() ?? '?'}
                    </span>
                    {item.userName}
                  </span>
                  <span>{formatWhen(item.createdAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
