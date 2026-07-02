import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/icons';
import type { SignoffItem } from '@/lib/data/home';

function submittedLabel(iso: string | null): string {
  if (!iso) return 'submitted';
  return `submitted ${new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

/** Tasks waiting for the viewer's sign-off. The primary call-to-action on a
 *  manager's home — each row deep-links to the task where they review & approve. */
export function ApprovalsInbox({ items }: { items: SignoffItem[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Awaiting your sign-off</CardTitle>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 tabular-nums dark:bg-amber-500/10 dark:text-amber-400">
          {items.length}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((t) => (
          <li key={t.id}>
            <Link
              href={`/projects/${t.projectId}/tasks/${t.id}`}
              className="group flex items-center gap-3 py-2.5"
            >
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:underline">{t.title}</p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {t.projectName} · {t.assigneeName} · {submittedLabel(t.submittedAt)}
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-zinc-300 group-hover:text-zinc-500" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
