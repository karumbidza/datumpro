'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/icons';
import type { PendingApproval, ApprovalKind } from '@/lib/data/home';

// Inlined (client component — can't import runtime values from lib/data/home,
// which pulls in server-only `next/headers`). Mirrors home.ts' KIND_LABEL.
const KIND_LABEL: Record<ApprovalKind, string> = {
  signoff: 'Sign-off',
  extension: 'Extension',
  variation: 'Variation',
};

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

const ACTIONS: Record<ApprovalKind, { primary: string; secondary: string }> = {
  signoff: { primary: 'Approve (mark done)', secondary: 'Reject' },
  extension: { primary: 'Grant extension', secondary: 'Decline' },
  variation: { primary: 'Approve variation', secondary: 'Reject' },
};

function href(item: PendingApproval): string {
  return item.taskId
    ? `/projects/${item.projectId}/tasks/${item.taskId}`
    : `/projects/${item.projectId}`;
}

/** Everything waiting on the viewer — task sign-offs, extension requests and
 *  submitted variations — in one expandable queue. Only one row is open at a
 *  time (first open by default); each row deep-links to where it's decided. */
export function ApprovalsInbox({ items }: { items: PendingApproval[] }) {
  const [expanded, setExpanded] = useState<number | null>(0);

  if (items.length === 0) {
    return (
      <Card>
        <CardTitle>Awaiting your approval</CardTitle>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          You&apos;re all caught up — nothing needs your approval right now.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Awaiting your approval</CardTitle>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 tabular-nums dark:bg-amber-500/10 dark:text-amber-400">
          {items.length}
        </span>
      </div>
      <ul className="mt-3">
        {items.map((t, i) => {
          const open = expanded === i;
          const actions = ACTIONS[t.kind];
          return (
            <li key={t.key} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : i)}
                className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left"
                aria-expanded={open}
              >
                <span className={`size-2 shrink-0 rounded-full ${DOT[t.kind]}`} />
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CHIP[t.kind]}`}>
                  {KIND_LABEL[t.kind]}
                </span>
                <span className="shrink-0 truncate text-sm font-medium">{t.title}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {t.projectName} · {t.detail}
                </span>
                <ChevronRight
                  size={16}
                  className={`shrink-0 text-zinc-300 transition-transform duration-150 dark:text-zinc-600 ${open ? 'rotate-90' : ''}`}
                />
              </button>
              {open && (
                <div className="pb-3 pl-5">
                  <p className="text-[13px] leading-normal text-zinc-700 dark:text-zinc-300">{t.detail}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={href(t)}
                      className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                    >
                      {actions.primary}
                    </Link>
                    <Link
                      href={href(t)}
                      className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      {actions.secondary}
                    </Link>
                    <Link
                      href={href(t)}
                      className="ml-auto text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Open full detail →
                    </Link>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
