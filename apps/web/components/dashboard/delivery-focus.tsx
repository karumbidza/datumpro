'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ChevronRight } from '@/components/icons';
import { ApprovalsInbox } from './approvals-inbox';
import type { PendingApproval } from '@/lib/data/home';

const cellCls =
  'block px-5 py-4 text-left [&:not(:last-child)]:border-r [&:not(:last-child)]:border-zinc-100 dark:[&:not(:last-child)]:border-zinc-800';

function color(tone: 'amber' | 'red' | 'zinc'): string {
  if (tone === 'red') return 'text-red-600 dark:text-red-400';
  if (tone === 'amber') return 'text-amber-600 dark:text-amber-400';
  return 'text-zinc-900 dark:text-white';
}

/** The PM's action focus in one strip. "Awaiting approval" is the live control:
 *  click it to expand the approvals queue inline — the count and the list are the
 *  same thing, so there's no separate always-on card. */
export function DeliveryFocus({
  approvals,
  blockers,
  overdue,
}: {
  approvals: PendingApproval[];
  blockers: number;
  overdue: number;
}) {
  const [open, setOpen] = useState(false);
  const awaiting = approvals.length;

  return (
    <div>
      <Card className="p-0">
        <div className="grid grid-cols-3">
          {/* Awaiting approval — toggles the queue below */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={`${cellCls} transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
              open ? 'bg-zinc-50 dark:bg-zinc-900' : ''
            }`}
          >
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              Awaiting approval
              <ChevronRight
                size={13}
                className={`text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`}
              />
            </span>
            <span className={`mt-1 block text-2xl font-semibold tabular-nums ${color(awaiting > 0 ? 'amber' : 'zinc')}`}>
              {awaiting}
            </span>
          </button>

          <div className={cellCls}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Blockers</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color(blockers > 0 ? 'red' : 'zinc')}`}>{blockers}</p>
          </div>

          <div className={cellCls}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Overdue</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color(overdue > 0 ? 'red' : 'zinc')}`}>{overdue}</p>
          </div>
        </div>
      </Card>

      {open && (
        <div className="mt-4">
          <ApprovalsInbox items={approvals} />
        </div>
      )}
    </div>
  );
}
