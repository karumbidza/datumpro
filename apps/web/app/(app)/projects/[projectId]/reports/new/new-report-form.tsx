'use client';

import { useActionState } from 'react';
import { createReport } from '../actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { WEATHER_OPTIONS } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function NewReportForm({ projectId, today }: { projectId: string; today: string }) {
  const [state, formAction] = useActionState(createReport, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <FormError error={state.error} />

      <div>
        <label className="mb-1 block text-sm font-medium">Date</label>
        <input type="date" name="reportDate" defaultValue={today} required className={inputClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Progress (%)</label>
        <input type="number" name="progressPct" min={0} max={100} defaultValue={0} className={inputClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Weather</label>
        <select name="weather" className={inputClass} defaultValue="">
          <option value="">—</option>
          {WEATHER_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Narrative</label>
        <textarea name="narrative" rows={5} className={inputClass} placeholder="What happened on site today?" />
      </div>

      <div className="flex gap-2 pt-2">
        <SubmitButton name="intent" value="submitted" pendingText="Submitting…">
          Submit report
        </SubmitButton>
        <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…">
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}
