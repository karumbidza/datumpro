'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from '@/components/icons';
import {
  addMilestone,
  setMilestoneStatus,
  deleteMilestone,
} from '@/app/(app)/projects/[projectId]/milestones-actions';

interface Milestone {
  id: string;
  name: string;
  target_date: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'missed';
}

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const DOT: Record<Milestone['status'], string> = {
  done: 'bg-green-500',
  in_progress: 'bg-amber-500',
  pending: 'bg-zinc-300 dark:bg-zinc-600',
  missed: 'bg-red-500',
};

const STATUS_OPTIONS: Milestone['status'][] = ['pending', 'in_progress', 'done', 'missed'];

function fmt(iso: string | null): string {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function MilestonesPanel({
  projectId,
  milestones,
  canManage,
}: {
  projectId: string;
  milestones: Milestone[];
  canManage: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Milestones</h2>

      {milestones.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No milestones yet.</p>
      ) : (
        <ul className="space-y-2">
          {milestones.map((m) => (
            <li key={m.id}>
              <Card className="flex items-center gap-3 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[m.status]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{m.name}</p>
                  <p className="text-xs text-zinc-400">Target {fmt(m.target_date)}</p>
                </div>
                {canManage ? (
                  <>
                    <form action={setMilestoneStatus}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="id" value={m.id} />
                      <select
                        name="status"
                        defaultValue={m.status}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className={inputClass}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </form>
                    <form action={deleteMilestone}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="id" value={m.id} />
                      <button
                        type="submit"
                        title="Delete milestone"
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                      >
                        <X size={16} />
                      </button>
                    </form>
                  </>
                ) : (
                  <span className="text-xs capitalize text-zinc-500">{m.status.replace('_', ' ')}</span>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form action={addMilestone} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input name="name" required placeholder="Milestone name" className={`${inputClass} flex-1`} />
          <input type="date" name="targetDate" className={inputClass} />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
