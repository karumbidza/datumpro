'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { addSubtask, updateSubtask, removeSubtask, submitBid } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { Subtask } from '@/lib/data/subtasks';
import type { TaskDoc } from '@/lib/data/tenders';
import { DocAttach } from '@/components/task/doc-attach';
import { formatUsd } from '@datumpro/shared/domain';

// Shared field styling — one height (40px) + radius everywhere, brand focus ring,
// no native number spinners.
// No width here — each field sets its own so the explicit widths below don't
// fight w-full (there's no tailwind-merge to resolve the conflict).
const field =
  'h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100';
const numField = `${field} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
const selectField = `${field} cursor-pointer appearance-none pr-8`;
const labelCls = 'mb-1.5 block text-[11.5px] font-semibold text-zinc-500 dark:text-zinc-400';
const selectStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
} as const;

const dollars = (cents: number) => (cents / 100).toFixed(2);
function dmy(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** A tender invitee's sealed bid: they build their own priced plan (bid-scoped
 *  subtasks) and submit it. RLS shows them only their own lines. */
export function BidPanel({
  taskId,
  projectId,
  orgId,
  bidLines,
  docs,
  submitted,
  taskStart,
  taskEnd,
}: {
  taskId: string;
  projectId: string;
  orgId: string;
  bidLines: Subtask[];
  docs: TaskDoc[];
  submitted: boolean;
  taskStart: string | null;
  taskEnd: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const total = bidLines.reduce((s, l) => s + l.costCents, 0);
  const lineIncomplete = (l: Subtask) =>
    l.costCents <= 0 || !l.estQty || l.estQty <= 0 || !l.estUnit || !l.plannedStartDate;
  const incomplete = bidLines.some(lineIncomplete);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-50">Your bid</h3>
        {submitted && (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-400">
            Submitted
          </span>
        )}
      </div>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-zinc-500 [text-wrap:pretty] dark:text-zinc-400">
        Break the work into the steps you’d do, each with a duration, a start date and a cost. This is your sealed
        bid — the PM compares it against others and awards the winner. You can edit until they decide.
      </p>

      {/* Add step — bordered sub-card */}
      <form
        action={addSubtask}
        className="mt-[22px] rounded-xl border border-zinc-200 bg-zinc-50/60 p-[18px] dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="bid" value="1" />
        <div>
          <label className={labelCls}>Step</label>
          <input name="title" required placeholder="e.g. Excavate footing" className={`${field} w-full`} />
        </div>
        <div className="mt-3.5 grid grid-cols-2 items-end gap-x-4 gap-y-3.5">
          <div>
            <label className={labelCls}>Duration</label>
            <div className="flex gap-2">
              <input name="estQty" type="number" min="0" step="0.5" placeholder="1" className={`${numField} min-w-0 flex-1`} />
              <select name="estUnit" defaultValue="days" className={`${selectField} w-[104px] shrink-0`} style={selectStyle}>
                <option value="days">day(s)</option>
                <option value="hours">hours</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Start</label>
            <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={`${field} w-full`} />
          </div>
          <div>
            <label className={labelCls}>Cost ($)</label>
            <input name="cost" type="number" min="0" step="0.01" placeholder="0.00" className={`${numField} w-full text-right`} />
          </div>
          <div className="flex items-end">
            <SubmitButton className="h-10 w-full" pendingText="Adding…">
              Add step
            </SubmitButton>
          </div>
        </div>
      </form>

      {/* Existing bid lines — clean step cards (tap to edit) */}
      {bidLines.length > 0 && (
        <div className="mt-4 flex flex-col gap-2.5">
          {bidLines.map((l) =>
            editing === l.id ? (
              <form
                key={l.id}
                action={updateSubtask}
                onSubmit={() => setEditing(null)}
                className="rounded-xl border border-brand-500/40 bg-brand-50/40 p-[18px] dark:bg-brand-500/5"
              >
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="projectId" value={projectId} />
                <div>
                  <label className={labelCls}>Step</label>
                  <input name="title" defaultValue={l.title} required className={`${field} w-full`} />
                </div>
                <div className="mt-3.5 grid grid-cols-2 items-end gap-x-4 gap-y-3.5">
                  <div>
                    <label className={labelCls}>Duration</label>
                    <div className="flex gap-2">
                      <input name="estQty" type="number" min="0" step="0.5" defaultValue={l.estQty ?? ''} className={`${numField} min-w-0 flex-1`} />
                      <select name="estUnit" defaultValue={l.estUnit ?? 'days'} className={`${selectField} w-[104px] shrink-0`} style={selectStyle}>
                        <option value="days">day(s)</option>
                        <option value="hours">hours</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Start</label>
                    <input type="date" name="plannedStartDate" defaultValue={l.plannedStartDate ?? ''} min={taskStart ?? undefined} max={taskEnd ?? undefined} className={`${field} w-full`} />
                  </div>
                  <div>
                    <label className={labelCls}>Cost ($)</label>
                    <input name="cost" type="number" min="0" step="0.01" defaultValue={dollars(l.costCents)} className={`${numField} w-full text-right`} />
                  </div>
                  <div className="flex items-end gap-2">
                    <SubmitButton className="h-10 flex-1" pendingText="Saving…">
                      Save
                    </SubmitButton>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="h-10 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div
                key={l.id}
                className="flex items-center gap-3.5 rounded-[10px] border border-zinc-200 px-4 py-[13px] dark:border-zinc-800"
              >
                <button type="button" onClick={() => setEditing(l.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{l.title}</div>
                  {lineIncomplete(l) ? (
                    <div className="mt-0.5 text-[12.5px] font-medium text-amber-600 dark:text-amber-400">
                      Tap to add duration, start &amp; cost
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[12.5px] text-zinc-400">
                      {l.estQty} {l.estUnit} · starts {dmy(l.plannedStartDate)}
                    </div>
                  )}
                </button>
                <div className="text-[15px] font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{formatUsd(l.costCents)}</div>
                <form action={removeSubtask}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <button
                    type="submit"
                    title="Remove"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                  >
                    ✕
                  </button>
                </form>
              </div>
            ),
          )}
        </div>
      )}

      {/* Total + submit */}
      <div className="mt-[22px] flex items-center justify-between border-t border-zinc-100 pt-5 dark:border-zinc-800">
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Your total&nbsp;
          <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{formatUsd(total)}</span>
        </div>
        <form action={submitBid}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <SubmitButton className="h-[42px] text-[14.5px]" pendingText="Submitting…" disabled={bidLines.length === 0 || incomplete}>
            {submitted ? 'Update bid' : 'Submit bid'}
          </SubmitButton>
        </form>
      </div>
      {bidLines.length > 0 && incomplete && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          Every step needs a duration, a start date and a cost before you can submit.
        </p>
      )}

      <DocAttach taskId={taskId} projectId={projectId} orgId={orgId} docs={docs} bid canEdit />
    </Card>
  );
}
