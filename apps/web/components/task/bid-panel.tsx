'use client';

import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { addSubtask, updateSubtask, removeSubtask, submitBid } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { Subtask } from '@/lib/data/subtasks';
import { formatUsd } from '@datumpro/shared/domain';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';
const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A tender invitee's sealed bid: they build their own priced plan (bid-scoped
 *  subtasks) and submit it. RLS shows them only their own lines. */
export function BidPanel({
  taskId,
  projectId,
  bidLines,
  submitted,
  taskStart,
  taskEnd,
}: {
  taskId: string;
  projectId: string;
  bidLines: Subtask[];
  submitted: boolean;
  taskStart: string | null;
  taskEnd: string | null;
}) {
  const total = bidLines.reduce((s, l) => s + l.costCents, 0);
  const incomplete = bidLines.some(
    (l) => l.costCents <= 0 || !l.estQty || l.estQty <= 0 || !l.estUnit || !l.plannedStartDate,
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Your bid</CardTitle>
        {submitted && (
          <span className="rounded bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
            Submitted
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Break the work into the steps you’d do, each with a duration, a start date and a cost. This is your sealed
        bid — the PM compares it against others and awards the winner. You can edit until they decide.
      </p>

      {/* existing bid lines — editable */}
      <div className="mt-3 space-y-2">
        {bidLines.map((s) => (
          <form
            key={s.id}
            action={updateSubtask}
            className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800"
          >
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Step</label>
              <input name="title" defaultValue={s.title} required className={`${inputClass} w-full`} />
            </div>
            <div className="w-16">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Qty</label>
              <input name="estQty" type="number" min="0" step="0.5" defaultValue={s.estQty ?? ''} className={`${inputClass} w-full`} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Unit</label>
              <select name="estUnit" defaultValue={s.estUnit ?? 'days'} className={inputClass}>
                <option value="hours">hours</option>
                <option value="days">day(s)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
              <input type="date" name="plannedStartDate" defaultValue={s.plannedStartDate ?? ''} min={taskStart ?? undefined} max={taskEnd ?? undefined} className={inputClass} />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Cost ($)</label>
              <input name="cost" type="number" min="0" step="0.01" defaultValue={dollars(s.costCents)} className={`${inputClass} w-full`} />
            </div>
            <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
            <button type="submit" formAction={removeSubtask} className="pb-1 text-[11px] text-zinc-400 hover:text-red-500" title="Remove step">
              ✕
            </button>
          </form>
        ))}
      </div>

      {/* add a step */}
      <form action={addSubtask} className="mt-2 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="bid" value="1" />
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">Add step</label>
          <input name="title" required placeholder="e.g. Excavate footing" className={`${inputClass} w-full`} />
        </div>
        <div className="w-16">
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">Qty</label>
          <input name="estQty" type="number" min="0" step="0.5" className={`${inputClass} w-full`} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">Unit</label>
          <select name="estUnit" defaultValue="days" className={inputClass}>
            <option value="hours">hours</option>
            <option value="days">day(s)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
          <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={inputClass} />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">Cost ($)</label>
          <input name="cost" type="number" min="0" step="0.01" className={`${inputClass} w-full`} />
        </div>
        <SubmitButton variant="secondary" pendingText="Adding…">Add</SubmitButton>
      </form>

      {/* total + submit */}
      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="text-sm text-zinc-500">
          Your total: <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{formatUsd(total)}</span>
        </span>
        <form action={submitBid}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <SubmitButton pendingText="Submitting…" disabled={bidLines.length === 0 || incomplete}>
            {submitted ? 'Update bid' : 'Submit bid'}
          </SubmitButton>
        </form>
      </div>
      {bidLines.length > 0 && incomplete && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Every step needs a duration, a start date and a cost before you can submit.</p>
      )}
    </Card>
  );
}
