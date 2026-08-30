import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import type { ActionInbox, InboxKind } from '@/lib/data/action-inbox';

const KIND_LABEL: Record<InboxKind, string> = {
  rfi_answer: 'Answer',
  rfi_close: 'Review',
  snag_fix: 'Fix',
  snag_verify: 'Verify',
  action_item: 'To-do',
};

const KIND_STYLE: Record<InboxKind, string> = {
  rfi_answer: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  rfi_close: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  snag_fix: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  snag_verify: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  action_item: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A personal roll-up of everything awaiting the user across the registers —
 *  RFIs, snags and their to-dos. Purely navigational: each row links to where
 *  the action is taken. Rendered only when there's something to show. */
export function WhatNeedsMe({ inbox }: { inbox: ActionInbox }) {
  if (inbox.total === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const shown = inbox.items.slice(0, 8);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>What needs you</CardTitle>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {inbox.total}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {shown.map((item) => {
          const overdue = item.dueDate != null && item.dueDate < today;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLE[item.kind]}`}>
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-900 dark:text-white">{item.title}</span>
                  {item.subtitle && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{item.subtitle}</span>}
                </span>
                {item.dueDate && (
                  <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                    {overdue ? 'Overdue' : fmtDate(item.dueDate)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {inbox.total > shown.length && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">+{inbox.total - shown.length} more</p>
      )}
    </Card>
  );
}
