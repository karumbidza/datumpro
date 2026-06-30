'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';

type Line = { description: string; quantity: number; unitPriceCents: number };

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Invoice editor. Line items are managed client-side and submitted as JSON to the
 *  createInvoice server action (passed in as `action`). */
export function InvoiceForm({
  action,
  projectId,
}: {
  action: (formData: FormData) => Promise<void>;
  projectId: string;
}) {
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitPriceCents: 0 }]);

  const patch = (i: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPriceCents), 0);

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

      <div>
        <label className="mb-1 block text-sm font-medium">Line items</label>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={l.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="Description"
                className={`${inputClass} flex-1`}
              />
              <input
                type="number"
                step="0.01"
                value={l.quantity}
                onChange={(e) => patch(i, { quantity: Number(e.target.value) })}
                className={`${inputClass} w-16`}
                title="Qty"
              />
              <input
                type="number"
                step="0.01"
                value={l.unitPriceCents / 100}
                onChange={(e) => patch(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) })}
                placeholder="Unit $"
                className={`${inputClass} w-24`}
              />
              <span className="w-24 text-right text-sm tabular-nums text-zinc-500">
                {formatUsd(Math.round(l.quantity * l.unitPriceCents))}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  className="text-zinc-400 hover:text-red-500"
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
