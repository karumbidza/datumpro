'use client';

import { useActionState } from 'react';
import { createProject } from '../actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function NewProjectForm() {
  const [state, formAction] = useActionState(createProject, {});
  return (
    <form action={formAction} className="space-y-4">
      <FormError error={state.error} />
      <div>
        <label className="mb-1 block text-sm font-medium">Project name</label>
        <input name="name" required placeholder="e.g. Riverside Office Block" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Client</label>
        <input name="clientName" placeholder="Client name" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Contract value (USD)</label>
        <input type="number" name="contractValue" min={0} step="0.01" defaultValue={0} className={inputClass} />
      </div>
      <div className="pt-2">
        <SubmitButton pendingText="Creating…">Create project</SubmitButton>
      </div>
    </form>
  );
}
