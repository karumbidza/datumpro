'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';
import type { BudgetBillingRow } from '@/lib/data/finance';

type Line = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  budgetLineId?: string | null;
};

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Invoice editor. Line items are managed client-side and submitted as JSON to the
 *  createInvoice server action (passed in as `action`). Lines can be pulled from
 *  the project's budget/BOQ — those carry a budgetLineId so the invoice traces
 *  back to the budget and billed-vs-budget stays honest. */
export function InvoiceForm({
  action,
  projectId,
  budgetLines = [],
}: {
  action: (formData: FormData) => Promise<void>;
  projectId: string;
  budgetLines?: BudgetBillingRow[];
}) {
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitPriceCents: 0 }]);

  const patch = (i: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPriceCents), 0);

  // Pull a budget line in as a new invoice row, prefilled with what's left to
  // bill. Drop the empty starter row the first time so it isn't left dangling.
  const addFromBudget = (b: BudgetBillingRow) => {
    const row: Line = {
      description: b.description,
      quantity: 1,
      unitPriceCents: Math.max(0, b.remainingCents),
      budgetLineId: b.id,
    };
    setLines((ls) => {
      const first = ls[0];
      const onlyEmptyStarter =
        ls.length === 1 && !!first && !first.description.trim() && first.unitPriceCents === 0;
      return onlyEmptyStarter ? [row] : [...ls, row];
    });
  };

  // Budget lines already on the invoice can't be added twice.
  const usedBudgetIds = new Set(lines.map((l) => l.budgetLineId).filter(Boolean));
  const billable = budgetLines.filter((b) => !usedBudgetIds.has(b.id));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Number</label>
          <input name="number" placeholder="auto" className={`${inputClass} w-full`} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Due date</label>
          <input name="dueDate" type="date" className={`${inputClass} w-full`} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Terms</label>
          <input name="paymentTerms" placeholder="e.g. 30 days" className={`${inputClass} w-full`} />
        </div>
      </div>

      {budgetLines.length > 0 && (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Add from budget / BOQ
            <span className="ml-1 text-xs font-normal text-zinc-400">
              ({billable.length} available)
            </span>
          </summary>
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {billable.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">Every budget line is already on this invoice.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {billable.map((b) => {
                  const fullyBilled = b.remainingCents <= 0;
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{b.description}</p>
                        <p className="text-xs text-zinc-400">
                          {formatUsd(b.billedCents)} billed of {formatUsd(b.budgetCents)} ·{' '}
                          <span className={fullyBilled ? 'text-amber-600 dark:text-amber-400' : ''}>
                            {formatUsd(b.remainingCents)} left
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addFromBudget(b)}
                        className="shrink-0 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700"
                      >
                        Add
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </details>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium">Line items</label>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <input
                  value={l.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="Description"
                  className={`${inputClass} w-full`}
                />
                {l.budgetLineId && (
                  <span className="mt-0.5 block text-[11px] text-brand-600 dark:text-brand-400">
                    from budget
                  </span>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                value={l.quantity}
                onChange={(e) => patch(i, { quantity: Number(e.target.value) })}
                className={`${inputClass} w-16 self-start`}
                title="Qty"
              />
              <input
                type="number"
                step="0.01"
                value={l.unitPriceCents / 100}
                onChange={(e) => patch(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) })}
                placeholder="Unit $"
                className={`${inputClass} w-24 self-start`}
              />
              <span className="w-24 self-start pt-2 text-right text-sm tabular-nums text-zinc-500">
                {formatUsd(Math.round(l.quantity * l.unitPriceCents))}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  className="self-start pt-1.5 text-zinc-400 hover:text-red-500"
                  aria-label="Remove line"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, unitPriceCents: 0 }])}
          className="mt-2 text-sm text-brand-500 hover:underline"
        >
          + Add line
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="text-sm font-medium">Total {formatUsd(total)}</span>
        <Button type="submit">Create invoice</Button>
      </div>
    </form>
  );
}
