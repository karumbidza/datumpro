'use client';

import { useActionState } from 'react';
import { requestExtension } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function ExtensionRequestForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(requestExtension, {});
  return (
    <form
      action={formAction}
      className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Proposed new due date</label>
          <input name="proposedDueDate" type="date" required className={inputClass} />
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs font-medium">Reason</label>
          <input name="reason" placeholder="e.g. rain delays, material lead-time" className={inputClass} />
        </div>
        <Button type="submit">Request extension</Button>
      </div>
      <FormError error={state.error} />
    </form>
  );
}
