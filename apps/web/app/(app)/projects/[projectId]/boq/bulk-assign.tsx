'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import type { BoqGeneratedTask } from '@/lib/data/boq';
import { bulkAssignBoqTasks } from './actions';

export interface ContractorOption {
  userId: string;
  name: string;
}

/** Tick section-tasks and hand them to a contractor in one go. Select a subset
 *  for one contractor, assign, then repeat for the next — each assignment goes
 *  through the contractor's normal acceptance gate. */
export function BulkAssign({
  projectId,
  tasks,
  contractors,
  memberNames,
}: {
  projectId: string;
  tasks: BoqGeneratedTask[];
  contractors: ContractorOption[];
  memberNames: Record<string, string>;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState('');

  const unassigned = tasks.filter((t) => !t.assigneeId);
  const allTicked = unassigned.length > 0 && unassigned.every((t) => ticked.has(t.id));

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setTicked(allTicked ? new Set() : new Set(unassigned.map((t) => t.id)));
  }

  if (tasks.length === 0) return null;

  return (
    <form action={bulkAssignBoqTasks} className="mt-4">
      <input type="hidden" name="projectId" value={projectId} />
      {[...ticked].map((id) => (
        <input key={id} type="hidden" name="taskIds" value={id} />
      ))}

      <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tick all unassigned tasks"
                  checked={allTicked}
                  onChange={toggleAll}
                  disabled={unassigned.length === 0}
                />
              </th>
              <th className="px-3 py-2 font-semibold">Task</th>
              <th className="px-3 py-2 font-semibold">Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.title}`}
                    checked={ticked.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                </td>
                <td className="px-3 py-2">{t.title}</td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                  {t.assigneeId
                    ? `${memberNames[t.assigneeId] ?? 'Assigned'}${
                        t.acceptanceStatus === 'pending' ? ' (awaiting acceptance)' : ''
                      }`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          name="assigneeId"
          required
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className={`${inputClass} max-w-xs`}
        >
          <option value="">Assign ticked to…</option>
          {contractors.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={ticked.size === 0 || !assigneeId}>
          Assign {ticked.size > 0 ? `${ticked.size} task${ticked.size === 1 ? '' : 's'}` : ''}
        </Button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Each contractor must accept before work starts — the bill&apos;s priced lines carry over as their plan.
        </p>
      </div>
    </form>
  );
}
