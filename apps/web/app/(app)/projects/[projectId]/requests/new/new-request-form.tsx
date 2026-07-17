'use client';

import { useActionState } from 'react';
import { createRequest } from '../actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { REQUEST_TYPES } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function NewRequestForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(createRequest, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <FormError error={state.error} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Type</label>
          <select name="type" defaultValue="rfi" className={inputClass}>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Amount (USD, if any)</label>
          <input name="amount" type="number" step="0.01" placeholder="0.00" className={inputClass} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Title</label>
        <input name="title" required placeholder="Short summary" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Description</label>
        <textarea name="description" rows={4} className={inputClass} />
      </div>
      <div className="pt-2">
        <SubmitButton pendingText="Creating…">Create request</SubmitButton>
      </div>
      <p className="text-xs text-zinc-400">
        Saved as a draft — submit it on the next screen to start the approval chain.
      </p>
    </form>
  );
}
