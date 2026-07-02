import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MyTaskItem } from '@/lib/data/home';

const SLA_TONE: Record<string, 'neutral' | 'green' | 'amber'> = {
  on_track: 'green',
  at_risk: 'amber',
  breached: 'amber',
  pending_signoff: 'neutral',
  blocked: 'amber',
};

const SLA_LABEL: Record<string, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  breached: 'Breached',
  blocked: 'Blocked',
};

function due(iso: string | null): { text: string; late: boolean } {
  if (!iso) return { text: 'No due date', late: false };
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const late = d < today;
  return { text: `Due ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`, late };
}

/** The viewer's own open work — soonest due first, with an SLA read. */
export function MyTasksCard({ tasks }: { tasks: MyTaskItem[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>My tasks</CardTitle>
        <span className="text-xs text-zinc-500 tabular-nums">{tasks.length} open</span>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing assigned to you right now.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map((t) => {
            const d = due(t.dueDate);
            return (
              <li key={t.id}>
                <Link
                  href={`/projects/${t.projectId}/tasks/${t.id}`}
                  className="group flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:underline">{t.title}</p>
                    <p className={`text-xs ${d.late ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {d.text}
                      {d.late ? ' · overdue' : ''}
                    </p>
                  </div>
                  {SLA_LABEL[t.slaStatus] && (
                    <Badge tone={SLA_TONE[t.slaStatus] ?? 'neutral'}>{SLA_LABEL[t.slaStatus]}</Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
