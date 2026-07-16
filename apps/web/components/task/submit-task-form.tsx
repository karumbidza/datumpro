'use client';

import { useActionState } from 'react';
import { submitTask } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Submit-for-sign-off form with inline validation errors (min notes, the
 *  declaration, and the evidence/plan gates) instead of an error page. */
export function SubmitTaskForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(submitTask, {});
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="taskId" value={taskId} />
      <FormError error={state.error} />
      <textarea name="notes" rows={3} placeholder="What was completed?" className={inputClass} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="declaration" /> I confirm this work is complete and accurate.
      </label>
      <SubmitButton pendingText="Submitting…">Submit</SubmitButton>
    </form>
  );
}
