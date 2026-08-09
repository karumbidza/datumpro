'use client';

import { useActionState } from 'react';
import { createBoq } from '../actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { inputClass, labelClass } from '@/components/ui/form';
import { BOQ_INDUSTRIES, BOQ_TYPES, BOQ_TYPE_LABELS, CURRENCIES } from '@datumpro/shared/domain';

export function NewBoqForm() {
  const [state, formAction] = useActionState(createBoq, {});
  // Rendered on the client so `new Date()` is the viewer's today, not the server's.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4">
      <FormError error={state.error} />

      <div>
        <label htmlFor="name" className={labelClass}>
          BOQ name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="off"
          className={inputClass}
          placeholder="e.g. Scooter Filling Station — Ardbennie"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="boqType" className={labelClass}>
            BOQ type
          </label>
          <select id="boqType" name="boqType" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select…
            </option>
            {BOQ_TYPES.map((t) => (
              <option key={t} value={t}>
                {BOQ_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="industry" className={labelClass}>
            Industry
          </label>
          <select id="industry" name="industry" defaultValue="" className={inputClass}>
            <option value="">Select…</option>
            {BOQ_INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="clientName" className={labelClass}>
            Client <span className="font-normal text-zinc-400">optional</span>
          </label>
          <input id="clientName" name="clientName" autoComplete="off" className={inputClass} placeholder="Client / owner" />
        </div>
        <div>
          <label htmlFor="reference" className={labelClass}>
            Project reference <span className="font-normal text-zinc-400">optional</span>
          </label>
          <input id="reference" name="reference" autoComplete="off" className={inputClass} placeholder="e.g. DP-2026-014" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="boqDate" className={labelClass}>
            Date
          </label>
          <input id="boqDate" name="boqDate" type="date" defaultValue={today} className={inputClass} />
        </div>
        <div>
          <label htmlFor="currency" className={labelClass}>
            Currency
          </label>
          <select id="currency" name="currency" defaultValue="USD" className={inputClass}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="location" className={labelClass}>
          Location <span className="font-normal text-zinc-400">optional</span>
        </label>
        <input id="location" name="location" autoComplete="off" className={inputClass} placeholder="e.g. Harare" />
      </div>

      <div className="flex justify-end pt-2">
        <SubmitButton pendingText="Creating…">Create BOQ →</SubmitButton>
      </div>
    </form>
  );
}
