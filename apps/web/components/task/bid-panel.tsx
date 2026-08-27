'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError, type FormState } from '@/components/ui/form-error';
import { submitBid } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { TaskDoc } from '@/lib/data/tenders';
import { DocAttach } from '@/components/task/doc-attach';

const field =
  'h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100';
const numField = `${field} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
const labelCls = 'mb-1.5 block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400';

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A tender invitee's sealed bid: ONE price for the whole task plus a note
 *  describing the works. The PM compares bids and awards a winner; the winning
 *  bid's price + note lock onto the task. Editable until the PM decides. */
export function BidPanel({
  taskId,
  projectId,
  orgId,
  bidPriceCents,
  worksNotes,
  docs,
  submitted,
}: {
  taskId: string;
  projectId: string;
  orgId: string;
  bidPriceCents: number | null;
  worksNotes: string | null;
  docs: TaskDoc[];
  submitted: boolean;
}) {
  const [state, action] = useActionState(submitBid, {} as FormState);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Your bid</h3>
        {submitted && (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-400">
            Submitted
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-[1.55] text-zinc-500 [text-wrap:pretty] dark:text-zinc-400">
        Give one price for the whole task and describe the works you&apos;ll do. This is your sealed bid — the PM
        compares it against others and awards a winner. You can update it until they decide.
      </p>

      <form action={action} className="mt-[22px] space-y-3.5">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="projectId" value={projectId} />
        <div>
          <label className={labelCls}>Bid price ($)</label>
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="0.00"
            defaultValue={bidPriceCents != null ? dollars(bidPriceCents) : ''}
            className={`${numField} w-full max-w-[220px] text-right`}
          />
        </div>
        <div>
          <label className={labelCls}>Works to be done</label>
          <textarea
            name="worksNotes"
            rows={4}
            required
            placeholder="Describe what you'll do to complete this task…"
            defaultValue={worksNotes ?? ''}
            className={`${field} h-auto w-full py-2 leading-relaxed`}
          />
        </div>
        <FormError error={state.error} />
        <SubmitButton className="h-[42px] text-sm" pendingText="Submitting…">
          {submitted ? 'Update bid' : 'Submit bid'}
        </SubmitButton>
      </form>

      <DocAttach taskId={taskId} projectId={projectId} orgId={orgId} docs={docs} bid canEdit />
    </Card>
  );
}
