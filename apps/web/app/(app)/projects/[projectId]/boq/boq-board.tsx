'use client';

import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { theadRowClass, thClass } from '@/components/ui/table';
import type { BoqSection, BoqItem } from '@/lib/data/boq';
import { bulkAssignBoqTasks } from './actions';

export interface SectionTask {
  taskId: string;
  assigneeId: string | null;
  acceptanceStatus: string | null;
}
export interface ContractorOption {
  userId: string;
  name: string;
}

/** Two-decimal, thousands-grouped, no currency prefix — the currency is stated
 *  once in the header, so the cells stay quiet and column-aligned. */
const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The project BOQ as a working table: the full priced bill grouped by section,
 * with a per-section "assigned to" contractor picker. Each section is one task;
 * changing its contractor posts the shared bulk-assign action (single task id),
 * and the contractor then goes through their normal acceptance gate. Line rows
 * are read-only here — rates/durations become editable in the negotiate step.
 */
export function BoqBoard({
  projectId,
  currency,
  sections,
  items,
  tasksBySection,
  contractors,
  memberNames,
}: {
  projectId: string;
  currency: string;
  sections: BoqSection[];
  items: BoqItem[];
  tasksBySection: Record<string, SectionTask>;
  contractors: ContractorOption[];
  memberNames: Record<string, string>;
}) {
  const childrenOf = (pid: string | null) =>
    sections.filter((s) => s.parentId === pid).sort((a, b) => a.position - b.position);
  const itemsOf = (sid: string) =>
    items.filter((it) => it.sectionId === sid).sort((a, b) => a.position - b.position);

  const sectionAmount = (sid: string): number =>
    itemsOf(sid).reduce((a, it) => a + it.amountCents, 0) +
    childrenOf(sid).reduce((a, c) => a + sectionAmount(c.id), 0);
  const sectionDays = (sid: string): number =>
    itemsOf(sid).reduce((a, it) => a + (it.durationDays ?? 0), 0) +
    childrenOf(sid).reduce((a, c) => a + sectionDays(c.id), 0);

  const rows: ReactElement[] = [];

  const renderSection = (s: BoqSection, depth: number, number: string) => {
    const task = tasksBySection[s.id];
    const assignee = task?.assigneeId ? memberNames[task.assigneeId] : null;
    rows.push(
      <tr
        key={`s-${s.id}`}
        className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <td className="px-3 py-2 text-right align-middle font-mono text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          {number}
        </td>
        <td className="px-3 py-2 align-middle">
          <span className="font-semibold text-zinc-900 dark:text-white" style={{ paddingLeft: depth * 14 }}>
            {s.name}
          </span>
        </td>
        <td className="px-3 py-2 align-middle">
          {task ? (
            <div className="flex items-center gap-2">
              <form action={bulkAssignBoqTasks} className="contents">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="taskIds" value={task.taskId} />
                <select
                  name="assigneeId"
                  aria-label={`Assign ${s.name}`}
                  defaultValue={task.assigneeId ?? ''}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="max-w-[11rem] truncate rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/25 dark:border-zinc-700"
                >
                  <option value="" disabled>
                    Unassigned
                  </option>
                  {contractors.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </form>
              {assignee && task.acceptanceStatus === 'pending' && <Badge tone="amber">awaiting</Badge>}
              {assignee && task.acceptanceStatus === 'accepted' && <Badge tone="green">accepted</Badge>}
            </div>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
          )}
        </td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right align-middle font-mono text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
          {money(sectionAmount(s.id))}
        </td>
        <td className="px-3 py-2 text-right align-middle font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {sectionDays(s.id) || '—'}
        </td>
      </tr>,
    );

    itemsOf(s.id).forEach((it) => {
      rows.push(
        <tr key={`i-${it.id}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
          <td className="px-3 py-2 text-right align-top font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
            {it.itemNo ?? ''}
          </td>
          <td className="px-3 py-2 align-top" colSpan={2}>
            <div className="text-zinc-800 dark:text-zinc-200" style={{ paddingLeft: 12 + depth * 14 }}>
              {it.description}
            </div>
            {it.uom && (
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500" style={{ paddingLeft: 12 + depth * 14 }}>
                {it.uom}
              </div>
            )}
          </td>
          <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {it.qty.toLocaleString()}
          </td>
          <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {money(it.budgetRateCents)}
          </td>
          <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
            {money(it.amountCents)}
          </td>
          <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
            {it.durationDays ?? '—'}
          </td>
        </tr>,
      );
    });

    childrenOf(s.id).forEach((c, i) => renderSection(c, depth + 1, `${number}.${i + 1}`));
  };

  childrenOf(null).forEach((s, i) => renderSection(s, 0, String(i + 1)));

  const grandAmount = childrenOf(null).reduce((a, s) => a + sectionAmount(s.id), 0);

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className={theadRowClass}>
            <th className={`${thClass} text-right`}>#</th>
            <th className={thClass}>Description</th>
            <th className={thClass}>Assigned to</th>
            <th className={`${thClass} text-right`}>Qty</th>
            <th className={`${thClass} text-right`}>Rate</th>
            <th className={`${thClass} text-right`}>Amount</th>
            <th className={`${thClass} text-right`}>Days</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
        <tfoot>
          <tr className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="px-3 py-2.5" colSpan={5} />
            <td className="px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">
              {currency} {money(grandAmount)}
            </td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
