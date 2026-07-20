'use client';

import { useActionState, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError, type FormState } from '@/components/ui/form-error';
import { ApprovalChain } from '@/components/approvals/approval-chain';
import {
  acceptTask,
  declineTask,
  returnTask,
  addSubtask,
  updateSubtask,
  removeSubtask,
  toggleSubtask,
  submitPlan,
} from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { Subtask } from '@/lib/data/subtasks';
import type { ApprovalStep } from '@/lib/data/approvals';
import { formatUsd } from '@datumpro/shared/domain';
import { MediaUploader } from '@/components/task/media-uploader';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

/** Counted scope = baseline lines + approved variations (mirrors the DB). */
function isCounted(s: Subtask): boolean {
  return !s.isVariation || s.variationStatus === 'approved';
}
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function SubtaskPanel({
  taskId,
  projectId,
  orgId,
  subtasks,
  mediaBySubtask,
  acceptanceStatus,
  isAssignee,
  assigneeName,
  taskStart,
  taskEnd,
  taskStatus,
  planSubmittedAt,
  planApprovedAt,
  awardedCostCents,
  planSteps,
  viewerRole,
}: {
  taskId: string;
  projectId: string;
  orgId: string;
  subtasks: Subtask[];
  mediaBySubtask: Record<string, { id: string; url: string | null; kind: string }[]>;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  isAssignee: boolean;
  canManage: boolean;
  assigneeName: string;
  taskStart: string | null;
  taskEnd: string | null;
  taskStatus: string;
  planSubmittedAt: string | null;
  planApprovedAt: string | null;
  awardedCostCents: number | null;
  planSteps: ApprovalStep[];
  viewerRole: string;
}) {
  const [declineOpen, setDeclineOpen] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [planErr, submitPlanAction] = useActionState(submitPlan, {} as FormState);

  const baseline = subtasks.filter((s) => !s.isVariation);
  const counted = subtasks.filter(isCounted);
  const doneCount = counted.filter((s) => s.isDone).length;
  const pct = counted.length ? Math.round((100 * doneCount) / counted.length) : 0;
  const draftTotal = baseline.reduce((sum, s) => sum + s.costCents, 0);

  // Priced-plan lifecycle applies only to tasks that go through acceptance
  // (contractor/contributor). Internal-staff tasks keep the simple checklist.
  const usesPlanFlow = acceptanceStatus !== null;
  const planDraft = usesPlanFlow && acceptanceStatus === 'accepted' && !planSubmittedAt && !planApprovedAt;
  const planPending = usesPlanFlow && !!planSubmittedAt && !planApprovedAt;
  const planLocked = usesPlanFlow && !!planApprovedAt;
  const wasSentBack = planSteps.some((s) => s.decision === 'rejected');

  const canHandBack =
    isAssignee && acceptanceStatus === 'accepted' && taskStatus !== 'submitted' && taskStatus !== 'done';
  // Ticking belongs to the assignee, and only once the baseline is approved
  // (or for legacy non-plan tasks).
  const canTick = isAssignee && (planLocked || !usesPlanFlow);

  const path = `/projects/${projectId}/tasks/${taskId}`;

  // ── Acceptance decision — shown to the assignee while pending ──
  if (acceptanceStatus === 'pending' && isAssignee) {
    return (
      <Card>
        <CardTitle>Accept this task?</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Review the task, then accept to plan your work and price it — or decline to send it back to the
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
        <CardTitle>{planDraft || planPending ? 'Plan & cost' : 'Task plan'}</CardTitle>
        {(planLocked || !usesPlanFlow) && (
          <span className="text-xs font-medium tabular-nums text-zinc-500">
            {doneCount}/{counted.length} done · {pct}%
          </span>
        )}
      </div>

      {acceptanceStatus === 'pending' && !isAssignee && (
        <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
          Waiting for {assigneeName} to accept the task.
        </p>
      )}
      {acceptanceStatus === 'rejected' && !planDraft && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">This task was declined and returned to the PM.</p>
      )}

      {/* ── AWARDED COST (baseline locked) ── */}
      {planLocked && (
        <div className="mt-2 flex items-center justify-between rounded-md bg-brand-50 px-3 py-2 text-sm dark:bg-brand-500/10">
          <span className="text-zinc-600 dark:text-zinc-300">Awarded value</span>
          <span className="font-semibold tabular-nums text-brand-700 dark:text-brand-300">
            {formatUsd(awardedCostCents ?? 0)}
          </span>
        </div>
      )}

      {/* ── PLAN AWAITING APPROVAL ── */}
      {planPending && (
        <div className="mt-3">
          <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
            <span className="text-amber-700 dark:text-amber-400">
              {isAssignee ? 'Your plan is awaiting approval.' : 'Priced plan submitted — awaiting approval.'}
            </span>
            <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-300">{formatUsd(draftTotal)}</span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {baseline.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-700 dark:text-zinc-200">{s.title}</span>
                <span className="text-[11px] tabular-nums text-zinc-400">
                  {s.estQty ? `${s.estQty} ${s.estUnit}` : ''} · {formatUsd(s.costCents)}
                </span>
              </li>
            ))}
          </ul>
          <ApprovalChain steps={planSteps} viewerRole={viewerRole} path={path} />
        </div>
      )}

      {/* ── PLAN DRAFT — the priced plan editor (assignee only) ── */}
      {planDraft && isAssignee && (
        <div className="mt-3">
          {wasSentBack && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
              Your plan was sent back. Revise the steps or costs below and resubmit.
            </p>
          )}
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Break the task into the steps needed to complete it, each with a duration, a start date and a cost. This is
            your quote — it goes to the PM &amp; admin for approval.
          </p>

          {/* existing baseline rows — editable */}
          <div className="mt-3 space-y-2">
            {baseline.map((s) => (
              <form
                key={s.id}
                action={updateSubtask}
                className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800"
              >
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="projectId" value={projectId} />
                <div className="min-w-40 flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Step</label>
                  <input name="title" defaultValue={s.title} required className={`${inputClass} w-full`} />
                </div>
                <div className="w-16">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Qty</label>
                  <input
                    name="estQty"
                    type="number"
                    min="0"
                    step="0.5"
                    defaultValue={s.estQty ?? ''}
                    className={`${inputClass} w-full`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Unit</label>
                  <select name="estUnit" defaultValue={s.estUnit ?? 'days'} className={inputClass}>
                    <option value="hours">hours</option>
                    <option value="days">day(s)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
                  <input
                    type="date"
                    name="plannedStartDate"
                    defaultValue={s.plannedStartDate ?? ''}
                    min={taskStart ?? undefined}
                    max={taskEnd ?? undefined}
                    className={inputClass}
                  />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Cost ($)</label>
                  <input
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={dollars(s.costCents)}
                    className={`${inputClass} w-full`}
                  />
                </div>
                <SubmitButton variant="secondary" pendingText="Saving…">
                  Save
                </SubmitButton>
                <button
                  type="submit"
                  formAction={removeSubtask}
                  className="pb-1 text-[11px] text-zinc-400 hover:text-red-500"
                  title="Remove step"
                >
                  ✕
                </button>
              </form>
            ))}
          </div>

          {/* add a step */}
          <form
            action={addSubtask}
            className="mt-2 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
          >
            <input type="hidden" name="taskId" value={taskId} />
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Add step</label>
              <input name="title" required placeholder="e.g. Excavate footing" className={`${inputClass} w-full`} />
            </div>
            <div className="w-16">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Qty</label>
              <input name="estQty" type="number" min="0" step="0.5" className={`${inputClass} w-full`} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Unit</label>
              <select name="estUnit" defaultValue="days" className={inputClass}>
                <option value="hours">hours</option>
                <option value="days">day(s)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
              <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={inputClass} />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">Cost ($)</label>
              <input name="cost" type="number" min="0" step="0.01" className={`${inputClass} w-full`} />
            </div>
            <SubmitButton variant="secondary" pendingText="Adding…">
              Add
            </SubmitButton>
          </form>

          {/* total + submit */}
          <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <span className="text-sm text-zinc-500">
              Total quote: <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{formatUsd(draftTotal)}</span>
            </span>
            <form action={submitPlanAction}>
              <input type="hidden" name="taskId" value={taskId} />
              <SubmitButton pendingText="Submitting…" disabled={baseline.length === 0}>
                Submit plan for approval
              </SubmitButton>
            </form>
          </div>
          <FormError error={planErr.error} />

        </div>
      )}
      {planDraft && !isAssignee && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{assigneeName} is preparing a priced plan.</p>
      )}

      {/* ── LOCKED PLAN / LEGACY — checklist ── */}
      {(planLocked || !usesPlanFlow) && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>

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

          <ul className="mt-3 space-y-1.5">
            {counted.map((s) => (
              <li key={s.id} className="rounded-md px-1 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <form action={toggleSubtask} className="flex items-center">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="done" value={s.isDone ? 'false' : 'true'} />
                    <input
                      type="checkbox"
                      checked={s.isDone}
                      disabled={!canTick}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="h-4 w-4 accent-brand-600"
                    />
                  </form>
                  <span className={`flex-1 text-sm ${s.isDone ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'}`}>
                    {s.title}
                    {s.isVariation && (
                      <span className="ml-1.5 rounded bg-brand-100 px-1 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                        variation
                      </span>
                    )}
                  </span>
                  {usesPlanFlow && s.costCents > 0 && (
                    <span className="text-[11px] tabular-nums text-zinc-400">{formatUsd(s.costCents)}</span>
                  )}
                  {(s.plannedStartDate || s.estQty) && (
                    <span className="text-[11px] tabular-nums text-zinc-400">
                      {s.estQty ? `${s.estQty}${s.estUnit === 'hours' ? 'h' : 'd'}` : ''}
                      {s.plannedStartDate ? ` · ${s.plannedStartDate}` : ''}
                    </span>
                  )}
                  {!usesPlanFlow && canTick && (
                    <form action={removeSubtask}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="taskId" value={taskId} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <button type="submit" className="text-[11px] text-zinc-400 hover:text-red-500" title="Remove">
                        ✕
                      </button>
                    </form>
                  )}
                </div>

                {((s.plannedStartDate || (mediaBySubtask[s.id]?.length ?? 0) > 0) || canTick) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                    {(mediaBySubtask[s.id] ?? []).map((m) =>
                      m.url ? (
                        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" title="Open photo">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.url}
                            alt="Step evidence"
                            className="h-11 w-11 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                          />
                        </a>
                      ) : null,
                    )}
                    {canTick && (
                      <MediaUploader
                        taskId={taskId}
                        projectId={projectId}
                        orgId={orgId}
                        purpose="subtask"
                        subtaskId={s.id}
                        accept="image/*"
                        label="Add step photo"
                        compact
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
            {counted.length === 0 && (
              <li className="py-2 text-sm text-zinc-400">
                {!usesPlanFlow && canTick ? 'Break the task into steps below.' : 'No plan steps.'}
              </li>
            )}
          </ul>

          {/* Legacy/internal tasks keep a simple (uncosted) add-step form. */}
          {!usesPlanFlow && canTick && (
            <form
              action={addSubtask}
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
            >
              <input type="hidden" name="taskId" value={taskId} />
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-[11px] font-medium text-zinc-500">Step</label>
                <input name="title" required placeholder="e.g. Set formwork" className={`${inputClass} w-full`} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
                <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500">End</label>
                <input type="date" name="plannedEndDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={inputClass} />
              </div>
              <SubmitButton variant="secondary" pendingText="Adding…">
                Add step
              </SubmitButton>
            </form>
          )}

          {canTick && counted.length > 0 && doneCount < counted.length && (
            <p className="mt-2 text-[11px] text-zinc-400">Tick off every step to unlock “Submit for sign-off”.</p>
          )}
        </>
      )}

      {canHandBack && (
        <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {!handBackOpen ? (
            <button
              type="button"
              onClick={() => setHandBackOpen(true)}
              className="text-[11px] font-medium text-zinc-400 hover:text-red-500"
            >
              Can’t complete this? Hand the task back
            </button>
          ) : (
            <form action={returnTask} className="space-y-2">
              <input type="hidden" name="taskId" value={taskId} />
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Hand back to the project manager — why? <span className="text-zinc-400">(shared with them)</span>
              </label>
              <textarea
                name="reason"
                rows={2}
                required
                placeholder="e.g. Materials aren’t available — this needs to be rescheduled."
                className={`${inputClass} w-full text-sm`}
              />
              <div className="flex gap-2">
                <SubmitButton variant="secondary" pendingText="Handing back…">
                  Hand back task
                </SubmitButton>
                <button type="button" onClick={() => setHandBackOpen(false)} className="text-sm text-zinc-500 hover:underline">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
