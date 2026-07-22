import Link from 'next/link';
import { Card } from '@/components/ui/card';

interface Cell {
  label: string;
  value: number;
  tone: 'amber' | 'red' | 'zinc';
  href?: string;
}

const cellCls =
  'block px-5 py-4 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-zinc-100 dark:[&:not(:last-child)]:border-zinc-800';

function color(tone: Cell['tone']): string {
  if (tone === 'red') return 'text-red-600 dark:text-red-400';
  if (tone === 'amber') return 'text-amber-600 dark:text-amber-400';
  return 'text-zinc-900 dark:text-white';
}

/** The project manager's action focus — what needs a decision now, distinct from
 *  the portfolio's neutral project counts. Zero counts fade to neutral so a live
 *  number stands out. Open requests links straight to the requests queue. */
export function DeliveryFocus({
  awaitingApproval,
  blockers,
  overdue,
  openRequests,
}: {
  awaitingApproval: number;
  blockers: number;
  overdue: number;
  openRequests: number;
}) {
  const cells: Cell[] = [
    { label: 'Awaiting approval', value: awaitingApproval, tone: awaitingApproval > 0 ? 'amber' : 'zinc' },
    { label: 'Blockers', value: blockers, tone: blockers > 0 ? 'red' : 'zinc' },
    { label: 'Overdue', value: overdue, tone: overdue > 0 ? 'red' : 'zinc' },
    { label: 'Open requests', value: openRequests, tone: openRequests > 0 ? 'amber' : 'zinc', href: '/requests' },
  ];
  return (
    <Card className="p-0">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {cells.map((c) => {
          const body = (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${color(c.tone)}`}>{c.value}</p>
            </>
          );
          return c.href ? (
            <Link
              key={c.label}
              href={c.href}
              className={`${cellCls} transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900`}
            >
              {body}
            </Link>
          ) : (
            <div key={c.label} className={cellCls}>
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
