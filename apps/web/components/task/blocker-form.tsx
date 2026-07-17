'use client';

import { useActionState } from 'react';
import { raiseBlocker } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { Button } from '@/components/ui/button';
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
      <Button type="submit" variant="secondary">Raise blocker</Button>
    </form>
  );
}
