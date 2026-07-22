'use client';

import { useActionState } from 'react';
import { raiseBlocker } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { FormError } from '@/components/ui/form-error';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function BlockerForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(raiseBlocker, {});
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="taskId" value={taskId} />
      <textarea name="description" rows={2} required placeholder="What's blocking you?" className={inputClass} />
      <FormError error={state.error} />
      <button
        type="submit"
        className="inline-flex h-[42px] w-full items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        Raise blocker
      </button>
    </form>
  );
}
