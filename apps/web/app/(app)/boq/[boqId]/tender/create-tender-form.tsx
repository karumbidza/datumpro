'use client';

import { useActionState, useState } from 'react';
import { createTender } from './actions';
import { FormError } from '@/components/ui/form-error';
import { SubmitButton } from '@/components/ui/submit-button';
import { inputClass, labelClass, Req } from '@/components/ui/form';

interface Props {
  boqId: string;
  defaultTitle?: string;
}

export function CreateTenderForm({ boqId, defaultTitle = '' }: Props) {
  const [state, formAction] = useActionState(createTender, {});
  // The datetime-local input yields a NAIVE local string; convert to a UTC ISO
  // here (browser knows the local TZ) so the server stores the correct instant.
  // Posting the naive value let the UTC server read "10:00" as 10:00 UTC.
  const [closeLocal, setCloseLocal] = useState('');
  const closeIso = (() => {
    if (!closeLocal) return '';
    const d = new Date(closeLocal);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  })();

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <input type="hidden" name="boqId" value={boqId} />

      <FormError error={state.error} />

      <div>
        <label htmlFor="tender-title" className={labelClass}>
          Tender title<Req />
        </label>
        <input
          id="tender-title"
          name="title"
          required
          autoComplete="off"
          defaultValue={defaultTitle}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="tender-closeAt" className={labelClass}>
          Closing date &amp; time{' '}
          <span className="font-normal text-zinc-400">optional</span>
        </label>
        <input
          id="tender-closeAt"
          type="datetime-local"
          value={closeLocal}
          onChange={(e) => setCloseLocal(e.target.value)}
          className={inputClass}
        />
        {/* What the server actually receives: a UTC ISO derived from the local value. */}
        <input type="hidden" name="closeAt" value={closeIso} />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Leave blank for an open-ended tender — you can close it manually.
        </p>
      </div>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingText="Creating tender…">
          Put out to tender →
        </SubmitButton>
      </div>
    </form>
  );
}
