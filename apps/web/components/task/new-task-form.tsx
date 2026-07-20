'use client';

import { useActionState, useState } from 'react';
import { createTask } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { TASK_PRIORITIES } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

type Mode = 'direct' | 'tender' | 'unassigned';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'direct', label: 'Assign directly', hint: 'Send it to one person to accept and price.' },
  { value: 'tender', label: 'Put out to tender', hint: 'Invite contractors to bid, then award the winner.' },
  { value: 'unassigned', label: 'Leave unassigned', hint: 'Park it — assign or tender later.' },
];

export function NewTaskForm({
  projectId,
  members,
  taskOptions,
}: {
  projectId: string;
  members: { userId: string; name: string; role: string }[];
  taskOptions: { id: string; title: string }[];
}) {
  const [state, formAction] = useActionState(createTask, {});
  const [mode, setMode] = useState<Mode>('direct');
  const [deps, setDeps] = useState<string[]>([]);
  const toggleDep = (id: string) =>
    setDeps((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="assignmentMode" value={mode} />
      <FormError error={state.error} />

      <div>
        <label className="mb-1 block text-sm font-medium">Title</label>
        <input name="title" required placeholder="e.g. Pour ground-floor slab" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Description</label>
        <textarea name="description" rows={3} className={inputClass} />
      </div>

      <div className="max-w-[50%]">
        <label className="mb-1 block text-sm font-medium">Priority</label>
        <select name="priority" defaultValue="medium" className={inputClass}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Assignment mode */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">How is this handled?</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              aria-pressed={mode === m.value}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                mode === m.value
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800'
              }`}
            >
              <span className="block font-medium">{m.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{MODES.find((m) => m.value === mode)!.hint}</p>
      </div>

      {mode === 'direct' && (
        <div>
          <label className="mb-1 block text-sm font-medium">Assignee</label>
          <select name="assigneeId" defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose a person…
            </option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Schedule — the end date IS the due date. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Start</label>
          <input type="date" name="plannedStartDate" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            End <span className="font-normal text-zinc-400">· due date</span>
          </label>
          <input type="date" name="plannedEndDate" className={inputClass} />
        </div>
      </div>

      {/* Dependencies — this task can't start until these are done. */}
      {taskOptions.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            Depends on <span className="font-normal text-zinc-400">· optional</span>
          </label>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Pick tasks that must finish first. This task stays <span className="font-medium">blocked</span> until they’re
            done — you can still assign or tender it in the meantime.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            {taskOptions.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <input
                  type="checkbox"
                  checked={deps.includes(t.id)}
                  onChange={() => toggleDep(t.id)}
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="truncate">{t.title}</span>
              </label>
            ))}
          </div>
          {deps.map((id) => (
            <input key={id} type="hidden" name="predecessorIds" value={id} />
          ))}
        </div>
      )}

      <div className="pt-1">
        <SubmitButton pendingText="Creating…">
          {mode === 'tender' ? 'Create & invite bids' : 'Create task'}
        </SubmitButton>
      </div>
    </form>
  );
}
