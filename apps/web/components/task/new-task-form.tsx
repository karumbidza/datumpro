'use client';

import { useActionState } from 'react';
import { createTask } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { TASK_PRIORITIES } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export function NewTaskForm({
  projectId,
  members,
}: {
  projectId: string;
  members: { userId: string; name: string; role: string }[];
}) {
  const [state, formAction] = useActionState(createTask, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <FormError error={state.error} />
      <div>
        <label className="mb-1 block text-sm font-medium">Title</label>
        <input name="title" required placeholder="e.g. Pour ground-floor slab" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Description</label>
        <textarea name="description" rows={3} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Priority</label>
          <select name="priority" defaultValue="medium" className={inputClass}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Assignee</label>
          <select name="assigneeId" defaultValue="" className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Prefer to compare bids? Leave this <span className="font-medium">Unassigned</span>, create the task,
        then open its <span className="font-medium">Quotes</span> panel to invite two or more contractors and
        award the winner.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Start</label>
          <input type="date" name="plannedStartDate" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">End</label>
          <input type="date" name="plannedEndDate" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Due</label>
          <input type="date" name="dueDate" className={inputClass} />
        </div>
      </div>
      <div className="pt-2">
        <SubmitButton pendingText="Creating…">Create task</SubmitButton>
      </div>
    </form>
  );
}
