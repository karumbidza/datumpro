'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  acceptTask,
  declineTask,
  addSubtask,
  toggleSubtask,
  removeSubtask,
} from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { Subtask } from '@/lib/data/subtasks';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

export function SubtaskPanel({
  taskId,
  projectId,
  subtasks,
  acceptanceStatus,
  isAssignee,
  canManage,
  assigneeName,
  taskStart,
  taskEnd,
}: {
  taskId: string;
  projectId: string;
  subtasks: Subtask[];
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  isAssignee: boolean;
  canManage: boolean;
  assigneeName: string;
  /** The parent task's window — subtask dates are clamped to it. */
  taskStart: string | null;
  taskEnd: string | null;
}) {
  const [declineOpen, setDeclineOpen] = useState(false);
  const doneCount = subtasks.filter((s) => s.isDone).length;
  const pct = subtasks.length ? Math.round((100 * doneCount) / subtasks.length) : 0;
  const canEdit = isAssignee || canManage;

  // Acceptance decision — shown to the assigned contractor while pending.
  if (acceptanceStatus === 'pending' && isAssignee) {
    return (
      <Card>
        <CardTitle>Accept this task?</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Review the task, then accept to start planning your work — or decline to send it back to the
          project manager.
        </p>
        {!declineOpen ? (
          <div className="mt-3 flex gap-2">
            <form action={acceptTask}>
              <input type="hidden" name="taskId" value={taskId} />
              <SubmitButton pendingText="Accepting…">Accept task</SubmitButton>
            </form>
            <button
              type="button"
              onClick={() => setDeclineOpen(true)}
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200"
            >
              Decline
            </button>
          </div>
        ) : (
          <form action={declineTask} className="mt-3 space-y-2">
            <input type="hidden" name="taskId" value={taskId} />
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="Reason for declining (shared with the project manager)"
              className={`${inputClass} w-full text-sm`}
            />
            <div className="flex gap-2">
              <SubmitButton variant="secondary" pendingText="Sending…">
                Decline task
              </SubmitButton>
              <button
                type="button"
                onClick={() => setDeclineOpen(false)}
                className="text-sm text-zinc-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Task plan</CardTitle>
        <span className="text-xs font-medium tabular-nums text-zinc-500">
          {doneCount}/{subtasks.length} done · {pct}%
        </span>
      </div>

      {acceptanceStatus === 'pending' && !isAssignee && (
        <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
          Waiting for {assigneeName} to accept the task.
        </p>
      )}
      {acceptanceStatus === 'rejected' && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">This task was declined and returned to the PM.</p>
      )}

      {/* Progress bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-2 rounded-full bg-brand-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Schedule: completion vs time elapsed since the task started */}
      {(() => {
        if (!taskStart || !taskEnd) return null;
        const s = new Date(taskStart).getTime();
        const e = new Date(taskEnd).getTime();
        if (!(e > s)) return null;
        const elapsed = Math.round(Math.min(100, Math.max(0, ((Date.now() - s) / (e - s)) * 100)));
        const behind = elapsed > pct + 5;
        return (
          <p className={`mt-1.5 text-[11px] ${behind ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}`}>
            {elapsed}% of the timeline elapsed{behind ? ` · behind schedule (${pct}% done)` : ''}
          </p>
        );
      })()}

      {/* Subtask checklist */}
      <ul className="mt-3 space-y-1.5">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <form action={toggleSubtask} className="flex items-center">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="done" value={s.isDone ? 'false' : 'true'} />
              <input
                type="checkbox"
                checked={s.isDone}
                disabled={!canEdit}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-4 w-4 accent-brand-600"
              />
            </form>
            <span className={`flex-1 text-sm ${s.isDone ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'}`}>
              {s.title}
            </span>
            {(s.plannedStartDate || s.plannedEndDate) && (
              <span className="text-[11px] tabular-nums text-zinc-400">
                {s.plannedStartDate ?? '—'} → {s.plannedEndDate ?? '—'}
              </span>
            )}
            {canEdit && (
              <form action={removeSubtask}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="projectId" value={projectId} />
                <button type="submit" className="text-[11px] text-zinc-400 hover:text-red-500" title="Remove">
                  ✕
                </button>
              </form>
            )}
          </li>
        ))}
        {subtasks.length === 0 && (
          <li className="py-2 text-sm text-zinc-400">
            {canEdit ? 'Break the task into steps with timelines below.' : 'No plan yet.'}
          </li>
        )}
      </ul>

      {/* Add a subtask */}
      {canEdit && acceptanceStatus !== 'pending' && (
        <form action={addSubtask} className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <input type="hidden" name="taskId" value={taskId} />
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-[11px] font-medium text-zinc-500">Step</label>
            <input name="title" required placeholder="e.g. Set formwork" className={`${inputClass} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
            <input
              type="date"
              name="plannedStartDate"
              min={taskStart ?? undefined}
              max={taskEnd ?? undefined}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-500">End</label>
            <input
              type="date"
              name="plannedEndDate"
              min={taskStart ?? undefined}
              max={taskEnd ?? undefined}
              className={inputClass}
            />
          </div>
          <SubmitButton variant="secondary" pendingText="Adding…">
            Add step
          </SubmitButton>
        </form>
      )}

      {canEdit && subtasks.length > 0 && doneCount < subtasks.length && (
        <p className="mt-2 text-[11px] text-zinc-400">
          Tick off every step to unlock “Submit for sign-off”.
        </p>
      )}
    </Card>
  );
}
