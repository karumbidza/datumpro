import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/icons';
import { approvalKindLabel, type PendingApproval, type ApprovalKind } from '@/lib/data/home';

const DOT: Record<ApprovalKind, string> = {
  signoff: 'bg-blue-400',
  extension: 'bg-amber-400',
  variation: 'bg-purple-400',
};
const CHIP: Record<ApprovalKind, string> = {
  signoff: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  extension: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  variation: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
};

function href(item: PendingApproval): string {
  return item.taskId
    ? `/projects/${item.projectId}/tasks/${item.taskId}`
    : `/projects/${item.projectId}`;
}

/** Everything waiting on the viewer — task sign-offs, extension requests and
 *  submitted variations — in one queue. Each row deep-links to where it's
 *  decided. */
export function ApprovalsInbox({ items }: { items: PendingApproval[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Awaiting your approval</CardTitle>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 tabular-nums dark:bg-amber-500/10 dark:text-amber-400">
          {items.length}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((t) => (
          <li key={t.key}>
            <Link href={href(t)} className="group flex items-center gap-3 py-2.5">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.kind]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CHIP[t.kind]}`}>
                    {approvalKindLabel(t.kind)}
                  </span>
                  <span className="truncate text-sm font-medium group-hover:underline">{t.title}</span>
                </div>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {t.projectName} · {t.detail}
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
