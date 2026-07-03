'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatUsd } from '@datumpro/shared/domain';
import { raiseVariation, decideVariation } from '@/app/(app)/projects/[projectId]/variations-actions';
import type { VariationRow, VariationsResult } from '@/lib/data/variations';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS_TONE: Record<VariationRow['status'], 'neutral' | 'blue' | 'green' | 'amber'> = {
  draft: 'neutral',
  submitted: 'amber',
  approved: 'green',
  rejected: 'neutral',
};

const STATUS_LABEL: Record<VariationRow['status'], string> = {
  draft: 'draft',
  submitted: 'awaiting decision',
  approved: 'approved',
  rejected: 'rejected',
};

function impact(cents: number, days: number): string {
  const parts: string[] = [];
  if (cents !== 0) parts.push(`${cents > 0 ? '+' : '−'}${formatUsd(Math.abs(cents))}`);
  if (days !== 0) parts.push(`${days > 0 ? '+' : '−'}${Math.abs(days)}d`);
  return parts.length ? parts.join(' · ') : 'no cost/time change';
}

/** Change orders: any project member raises one (it submits for review); the PM
 *  approves or rejects. The DB enforces both — this only shows the affordances. */
export function VariationsPanel({
  projectId,
  data,
  canDecide,
}: {
  projectId: string;
  data: VariationsResult;
  canDecide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { rows, approvedCostCents, approvedDays, pendingCount } = data;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Variations</CardTitle>
        <span className="text-xs text-zinc-500">
          {pendingCount > 0 && <span className="text-amber-600 dark:text-amber-400">{pendingCount} to review · </span>}
          approved impact {impact(approvedCostCents, approvedDays)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No change orders yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((v) => (
            <li key={v.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {v.reference && <span className="text-zinc-400">{v.reference} · </span>}
                    {v.description}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {impact(v.costImpactCents, v.timeImpactDays)}
                    {v.raiserName && ` · raised by ${v.raiserName}`}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
              </div>

              {canDecide && v.status === 'submitted' && (
                <div className="mt-2 flex gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <form action={decideVariation}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="variationId" value={v.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <Button type="submit" variant="secondary">Approve</Button>
                  </form>
                  <form action={decideVariation}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="variationId" value={v.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <Button type="submit" variant="ghost">Reject</Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form action={raiseVariation} className="mt-4 space-y-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <input type="hidden" name="projectId" value={projectId} />
          <input name="description" required placeholder="Describe the change" className={inputClass} />
          <div className="flex flex-wrap gap-2">
            <input name="reference" placeholder="Ref (optional)" className={`${inputClass} min-w-28 flex-1`} />
            <input name="cost" type="number" step="0.01" placeholder="Cost ± $" className={`${inputClass} w-28`} title="Cost impact — negative for a credit" />
            <input name="timeDays" type="number" placeholder="Days ±" className={`${inputClass} w-20`} title="Time impact in days" />
          </div>
          <div className="flex gap-2">
            <Button type="submit">Submit for review</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          + Raise a variation
        </button>
      )}
    </Card>
  );
}
