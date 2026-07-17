'use client';

import { useActionState } from 'react';
import { submitQuote } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Contractor's blind bid: cost + payment terms + proposed window. Submit needs a
 *  positive cost; Decline skips it (both go through submitQuote via `decision`). */
export function QuoteSubmitForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(submitQuote, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium">Your cost (USD)</label>
          <input name="costDollars" type="number" step="0.01" placeholder="0.00" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium">Advance %</label>
            <input name="advancePct" type="number" min={0} max={100} placeholder="0" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Retention %</label>
            <input name="retentionPct" type="number" min={0} max={100} placeholder="0" className={inputClass} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium">Proposed start</label>
          <input name="proposedStart" type="date" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium">Proposed end</label>
          <input name="proposedEnd" type="date" className={inputClass} />
        </div>
      </div>
      <textarea name="justification" rows={2} placeholder="Scope of works / cost basis" className={inputClass} />
      <FormError error={state.error} />
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="submit">Submit quote</Button>
        <Button type="submit" name="decision" value="decline" variant="ghost">Decline</Button>
      </div>
    </form>
  );
}
