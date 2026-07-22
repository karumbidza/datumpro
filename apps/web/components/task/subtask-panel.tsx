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
  startTask,
  submitTask,
  raiseBlocker,
  requestExtension,
  removeTaskMedia,
} from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { Subtask } from '@/lib/data/subtasks';
import type { ApprovalStep } from '@/lib/data/approvals';
import type { TaskDoc } from '@/lib/data/tenders';
import type { ExtensionRequestRow } from '@/lib/data/tasks';
import type { TaskMediaRow } from '@/lib/data/quotes';
import { Badge } from '@/components/ui/badge';
import { DocAttach } from '@/components/task/doc-attach';
import { formatUsd } from '@datumpro/shared/domain';
import { MediaUploader } from '@/components/task/media-uploader';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

// Shared plan/bid field styling — one 40px height + radius, brand focus ring, no
// native number spinners, custom select chevron. Widths are set per-field so they
// don't fight (no tailwind-merge in the project).
const field =
  'h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100';
const numField = `${field} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
const selectField = `${field} cursor-pointer appearance-none pr-8`;
const stepLabel = 'mb-1.5 block text-[11.5px] font-semibold text-zinc-500 dark:text-zinc-400';
const capsCls = 'text-[10.5px] font-semibold uppercase tracking-[.05em] text-zinc-400';
const selectStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
} as const;

const EXT_TONE = { pending: 'neutral', approved: 'green', rejected: 'amber', cancelled: 'neutral' } as const;

/** Counted scope = baseline lines + approved variations (mirrors the DB). */
function isCounted(s: Subtask): boolean {
  return !s.isVariation || s.variationStatus === 'approved';
}
const dollars = (cents: number) => (cents / 100).toFixed(2);
function dmy(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
const stepIncomplete = (s: Subtask) =>
  s.costCents <= 0 || !s.estQty || s.estQty <= 0 || !s.estUnit || !s.plannedStartDate;

export function SubtaskPanel({
  taskId,
  projectId,
  orgId,
  subtasks,
  mediaBySubtask,
  acceptanceStatus,
  isAssignee,
  canManage,
  assigneeName,
  taskStart,
  taskEnd,
  taskStatus,
  planSubmittedAt,
  planApprovedAt,
  awardedCostCents,
  planSteps,
  variationSteps,
  viewerRole,
  planDocs,
  blockedByDeps = false,
  extensionRequests = [],
  extensionSteps = {},
  canRequestExtension = false,
  extensionPreStart = false,
  completionMedia = [],
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
  /** task_variation approval chains, keyed by the variation subtask's id. */
  variationSteps: Record<string, ApprovalStep[]>;
  viewerRole: string;
  planDocs: TaskDoc[];
  /** Predecessors not yet done — can't start the task while true. */
  blockedByDeps?: boolean;
  /** Extension-of-time requests raised on this task (assignee → PM/admin). */
  extensionRequests?: ExtensionRequestRow[];
  /** Approval chains keyed by extension request id. */
  extensionSteps?: Record<string, ApprovalStep[]>;
  /** Assignee may raise an extension (task in progress / blocked). */
  canRequestExtension?: boolean;
  /** Assignee, but the task hasn't started — explain why they can't yet. */
  extensionPreStart?: boolean;
  /** Files attached at submit / blocker time (photos, PDFs, etc.). */
  completionMedia?: TaskMediaRow[];
}) {
  const [declineOpen, setDeclineOpen] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false); // submit-for-sign-off modal
  const [blockerOpen, setBlockerOpen] = useState(false); // raise-blocker modal
  const [extensionOpen, setExtensionOpen] = useState(false); // extension request form
  const [planErr, submitPlanAction] = useActionState(submitPlan, {} as FormState);
  const [submitState, submitTaskAction] = useActionState(submitTask, {} as FormState);
  const [blockerState, raiseBlockerAction] = useActionState(raiseBlocker, {} as FormState);
  const [extErr, requestExtensionAction] = useActionState(requestExtension, {} as FormState);

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
  // Variations not yet part of the agreed scope (approved ones show in the checklist).
  const openVariations = subtasks.filter((s) => s.isVariation && s.variationStatus !== 'approved');
  const canAddVariation = isAssignee && planLocked && taskStatus !== 'submitted' && taskStatus !== 'done';
  const [variationOpen, setVariationOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // plan step being edited
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set()); // expanded checklist rows
  const [confirmStep, setConfirmStep] = useState<Subtask | null>(null); // step awaiting complete-confirm
  const toggleOpen = (id: string) =>
    setOpenSteps((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const canHandBack =
    isAssignee && acceptanceStatus === 'accepted' && taskStatus !== 'submitted' && taskStatus !== 'done';
  // Work is "commenced" once the assignee hits Start (status → in_progress).
  const started = taskStatus === 'in_progress';
  // Ticking belongs to the assignee — only after they START the task (and the
  // baseline is approved, or for legacy non-plan tasks). Start is the gate.
  const canTick = isAssignee && started && (planLocked || !usesPlanFlow);
  // Start is available once the plan is approved (or non-plan), the task hasn't
  // begun, isn't blocked by predecessors, and has at least one step to work.
  const canStartTask =
    isAssignee && taskStatus === 'todo' && !blockedByDeps && (planLocked || !usesPlanFlow) && subtasks.length > 0;
  // Submit / raise-blocker live at the foot of the plan once work has commenced.
  const canWorkflow = isAssignee && started;
  const planComplete = counted.length === 0 || counted.every((s) => s.isDone);
  const hasPendingExt = extensionRequests.some((r) => r.status === 'pending');

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
    <>
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
        <div className="mt-[22px]">
          {wasSentBack && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
              Your plan was sent back. Revise the steps or costs below and resubmit.
            </p>
          )}
          <p className="text-[13.5px] leading-[1.55] text-zinc-500 [text-wrap:pretty] dark:text-zinc-400">
            Break the task into the steps needed to complete it, each with a duration, a start date and a cost. This is
            your quote — it goes to the PM &amp; admin for approval.
          </p>

          {/* Add step — bordered sub-card, first */}
          <form
            action={addSubtask}
            className="mt-[18px] rounded-xl border border-zinc-200 bg-zinc-50/60 p-[18px] dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            <input type="hidden" name="taskId" value={taskId} />
            <div>
              <label className={stepLabel}>Step</label>
              <input name="title" required placeholder="e.g. Excavate footing" className={`${field} w-full`} />
            </div>
            <div className="mt-3.5 grid grid-cols-2 items-end gap-x-4 gap-y-3.5">
              <div>
                <label className={stepLabel}>Duration</label>
                <div className="flex gap-2">
                  <input name="estQty" type="number" min="0" step="0.5" placeholder="1" className={`${numField} min-w-0 flex-1`} />
                  <select name="estUnit" defaultValue="days" className={`${selectField} w-[104px] shrink-0`} style={selectStyle}>
                    <option value="days">day(s)</option>
                    <option value="hours">hours</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={stepLabel}>Start</label>
                <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={`${field} w-full`} />
              </div>
              <div>
                <label className={stepLabel}>Cost ($)</label>
                <input name="cost" type="number" min="0" step="0.01" placeholder="0.00" className={`${numField} w-full text-right`} />
              </div>
              <div className="flex items-end">
                <SubmitButton className="h-10 w-full" pendingText="Adding…">
                  Add step
                </SubmitButton>
              </div>
            </div>
          </form>

          {/* Existing plan lines — clean step cards (tap to edit) */}
          {baseline.length > 0 && (
            <div className="mt-4 flex flex-col gap-2.5">
              {baseline.map((s) =>
                editing === s.id ? (
                  <form
                    key={s.id}
                    action={updateSubtask}
                    onSubmit={() => setEditing(null)}
                    className="rounded-xl border border-brand-500/40 bg-brand-50/40 p-[18px] dark:bg-brand-500/5"
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <div>
                      <label className={stepLabel}>Step</label>
                      <input name="title" defaultValue={s.title} required className={`${field} w-full`} />
                    </div>
                    <div className="mt-3.5 grid grid-cols-2 items-end gap-x-4 gap-y-3.5">
                      <div>
                        <label className={stepLabel}>Duration</label>
                        <div className="flex gap-2">
                          <input name="estQty" type="number" min="0" step="0.5" defaultValue={s.estQty ?? ''} className={`${numField} min-w-0 flex-1`} />
                          <select name="estUnit" defaultValue={s.estUnit ?? 'days'} className={`${selectField} w-[104px] shrink-0`} style={selectStyle}>
                            <option value="days">day(s)</option>
                            <option value="hours">hours</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className={stepLabel}>Start</label>
                        <input type="date" name="plannedStartDate" defaultValue={s.plannedStartDate ?? ''} min={taskStart ?? undefined} max={taskEnd ?? undefined} className={`${field} w-full`} />
                      </div>
                      <div>
                        <label className={stepLabel}>Cost ($)</label>
                        <input name="cost" type="number" min="0" step="0.01" defaultValue={dollars(s.costCents)} className={`${numField} w-full text-right`} />
                      </div>
                      <div className="flex items-end gap-2">
                        <SubmitButton className="h-10 flex-1" pendingText="Saving…">
                          Save
                        </SubmitButton>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="h-10 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div key={s.id} className="flex items-center gap-3.5 rounded-[10px] border border-zinc-200 px-4 py-[13px] dark:border-zinc-800">
                    <button type="button" onClick={() => setEditing(s.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
                      {stepIncomplete(s) ? (
                        <div className="mt-0.5 text-[12.5px] font-medium text-amber-600 dark:text-amber-400">
                          Tap to add duration, start &amp; cost
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[12.5px] text-zinc-400">
                          {s.estQty} {s.estUnit} · starts {dmy(s.plannedStartDate)}
                        </div>
                      )}
                    </button>
                    <div className="text-[15px] font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{formatUsd(s.costCents)}</div>
                    <form action={removeSubtask}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="taskId" value={taskId} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <button type="submit" title="Remove" className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                        ✕
                      </button>
                    </form>
                  </div>
                ),
              )}
            </div>
          )}

          {/* total + submit */}
          <div className="mt-[22px] flex items-center justify-between border-t border-zinc-100 pt-5 dark:border-zinc-800">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Total quote&nbsp;
              <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{formatUsd(draftTotal)}</span>
            </div>
            <form action={submitPlanAction}>
              <input type="hidden" name="taskId" value={taskId} />
              <SubmitButton className="h-[42px] text-[14.5px]" pendingText="Submitting…" disabled={baseline.length === 0 || baseline.some(stepIncomplete)}>
                Submit plan for approval
              </SubmitButton>
            </form>
          </div>
          {baseline.length > 0 && baseline.some(stepIncomplete) && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              Every step needs a duration, a start date and a cost before you can submit.
            </p>
          )}
          <FormError error={planErr.error} />
        </div>
      )}
      {planDraft && !isAssignee && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{assigneeName} is preparing a priced plan.</p>
      )}

      {/* ── LOCKED PLAN / LEGACY — checklist ── */}
      {(planLocked || !usesPlanFlow) && (
        <>
          {/* Start the task — the gate that unlocks ticking steps off. */}
          {canStartTask && (
            <form action={startTask} className="mt-3">
              <input type="hidden" name="taskId" value={taskId} />
              <SubmitButton className="h-[42px] w-full text-[14.5px]" pendingText="Starting…">
                Start task
              </SubmitButton>
            </form>
          )}
          {isAssignee && taskStatus === 'todo' && blockedByDeps && (
            <p className="mt-3 text-[12px] text-zinc-400">
              Waiting on predecessor tasks — you can start once they’re done.
            </p>
          )}

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

          <ul className="mt-3 space-y-2">
            {counted.map((s) => {
              const open = openSteps.has(s.id);
              const meta = [
                usesPlanFlow && s.costCents > 0 ? formatUsd(s.costCents) : null,
                s.estQty ? `${s.estQty}${s.estUnit === 'hours' ? 'h' : 'd'}` : null,
                s.plannedStartDate,
              ]
                .filter(Boolean)
                .join(' · ');
              const photos = mediaBySubtask[s.id] ?? [];
              return (
                <li
                  key={s.id}
                  className={`overflow-hidden rounded-[9px] border ${
                    s.isDone
                      ? 'border-green-100 bg-green-50/40 dark:border-green-500/20 dark:bg-green-500/5'
                      : 'border-zinc-100 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleOpen(s.id)}
                      aria-label={open ? 'Collapse step' : 'Expand step'}
                      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md text-[11px] text-zinc-400 transition-transform hover:bg-zinc-100 dark:hover:bg-zinc-800 ${open ? 'rotate-90' : ''}`}
                    >
                      ▶
                    </button>
                    {s.isDone && (
                      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-green-500 text-[10px] text-white shadow-[0_0_0_3px_rgba(34,197,94,.18)]">
                        ✓
                      </span>
                    )}
                    <span className={`flex-1 text-sm font-medium ${s.isDone ? 'text-zinc-500 line-through' : 'text-zinc-800 dark:text-zinc-100'}`}>
                      {s.title}
                      {s.isVariation && (
                        <span className="ml-1.5 rounded bg-brand-100 px-1 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                          variation
                        </span>
                      )}
                    </span>
                    {meta && <span className="text-[12.5px] tabular-nums text-zinc-400">{meta}</span>}
                  </div>

                  {open && (
                    <div className="border-t border-dashed border-zinc-200 py-3 pr-4 pl-11 dark:border-zinc-700">
                      {canTick ? (
                        <div className="flex flex-col gap-3">
                          <label
                            className={`flex items-center gap-2.5 text-[13.5px] ${
                              s.isDone ? 'cursor-default font-medium text-green-600 dark:text-green-400' : 'cursor-pointer text-zinc-700 dark:text-zinc-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={s.isDone}
                              disabled={s.isDone}
                              onChange={() => {
                                if (!s.isDone) setConfirmStep(s);
                              }}
                              className="h-[17px] w-[17px] accent-brand-600"
                            />
                            {s.isDone ? 'Completed' : 'Mark this step complete'}
                          </label>
                          <div>
                            <div className={`${capsCls} mb-1.5`}>Proof of work</div>
                            <div className="flex flex-wrap items-center gap-2">
                              {photos.map((m) =>
                                m.url ? (
                                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer" title="Open photo">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={m.url} alt="Step evidence" className="h-[46px] w-[46px] rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
                                  </a>
                                ) : null,
                              )}
                              {!s.isDone && (
                                <MediaUploader
                                  taskId={taskId}
                                  projectId={projectId}
                                  orgId={orgId}
                                  purpose="subtask"
                                  subtaskId={s.id}
                                  accept="image/*"
                                  label="Attach proof"
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2 text-[13px]">
                          <span className={capsCls}>Duration</span>
                          <span className="text-zinc-600 dark:text-zinc-300">{s.estQty ? `${s.estQty} ${s.estUnit}` : '—'}</span>
                          <span className={capsCls}>Start</span>
                          <span className="text-zinc-600 dark:text-zinc-300">{s.plannedStartDate ?? '—'}</span>
                          <span className={capsCls}>Status</span>
                          <span className={s.isDone ? 'font-semibold text-green-600 dark:text-green-400' : 'text-zinc-500'}>
                            {s.isDone ? `Completed${s.doneAt ? ` · ${s.doneAt.slice(0, 10)}` : ''}` : 'Pending'}
                          </span>
                          {photos.length > 0 && (
                            <>
                              <span className={`${capsCls} self-start pt-1`}>Proof</span>
                              <div className="flex flex-wrap gap-2">
                                {photos.map((m) =>
                                  m.url ? (
                                    <a key={m.id} href={m.url} target="_blank" rel="noreferrer" title="Open photo">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={m.url} alt="Step evidence" className="h-[46px] w-[46px] rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
                                    </a>
                                  ) : null,
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
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

          {counted.length > 0 &&
            (canTick ? (
              <p className="mt-2.5 text-[11.5px] text-zinc-400">
                Open a step to tick it off and attach proof. Marking complete is final.
              </p>
            ) : isAssignee && usesPlanFlow && taskStatus === 'todo' ? (
              <p className="mt-2.5 text-[11.5px] text-zinc-400">
                Start the task above to tick steps off and attach proof.
              </p>
            ) : usesPlanFlow ? (
              <p className="mt-2.5 text-[11.5px] text-zinc-400">
                Read-only — the assignee ticks steps and attaches proof. Open a step to review time and evidence.
              </p>
            ) : null)}

          {/* Variations & Extension-of-time render below the workflow buttons. */}
        </>
      )}

      {usesPlanFlow && (planDraft || planPending || planLocked) && (
        <DocAttach taskId={taskId} projectId={projectId} orgId={orgId} docs={planDocs} canEdit={isAssignee} />
      )}

      {/* Files attached at submit / blocker time — kept visible here now that the
          Evidence tab is gone. Retrievable by the assignee and the PM/admin. */}
      {completionMedia.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Attachments</p>
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {completionMedia.map((m) => (
              <li key={m.id} className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                {m.kind === 'photo' && m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.caption ?? 'Attachment'} className="h-20 w-full object-cover" />
                  </a>
                ) : (
                  <a
                    href={m.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-20 w-full items-center justify-center bg-zinc-50 px-1 text-center text-[11px] text-brand-500 underline dark:bg-zinc-900"
                  >
                    {m.kind === 'video' ? '▶ Video' : 'View file'}
                  </a>
                )}
                {(isAssignee || canManage) && (
                  <form action={removeTaskMedia} className="absolute right-1 top-1">
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="mediaId" value={m.id} />
                    <button
                      type="submit"
                      title="Remove"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-[10px] text-white hover:bg-black/70"
                    >
                      ✕
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Commenced work: submit for sign-off / raise a blocker ── */}
      {canWorkflow && (
        <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            disabled={!planComplete}
            title={planComplete ? undefined : 'Complete every step above first'}
            className="inline-flex h-[44px] flex-1 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Submit for sign-off
          </button>
          <button
            type="button"
            onClick={() => setBlockerOpen(true)}
            className="inline-flex h-[44px] flex-1 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Raise a blocker
          </button>
        </div>
      )}
      {canWorkflow && !planComplete && (
        <p className="mt-2 text-[11.5px] text-zinc-400">
          Complete every step above to submit for sign-off.
        </p>
      )}

      {/* ── Variations + Extension of time — side by side, below the actions ── */}
      {((planLocked && (openVariations.length > 0 || canAddVariation)) ||
        extensionRequests.length > 0 ||
        canRequestExtension ||
        extensionPreStart) && (
        <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:grid-cols-2">
          {/* Variations column */}
          {planLocked && (openVariations.length > 0 || canAddVariation) && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Variations</p>

              {openVariations.map((v) => (
                <div key={v.id} className="mt-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{v.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] tabular-nums text-zinc-400">{formatUsd(v.costCents)}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          v.variationStatus === 'rejected'
                            ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                        }`}
                      >
                        {v.variationStatus === 'rejected' ? 'Declined' : 'Pending'}
                      </span>
                    </span>
                  </div>
                  {v.variationStatus === 'pending' && (
                    <ApprovalChain steps={variationSteps[v.id] ?? []} viewerRole={viewerRole} path={path} />
                  )}
                </div>
              ))}

              {canAddVariation &&
                (!variationOpen ? (
                  <button
                    type="button"
                    onClick={() => setVariationOpen(true)}
                    className="mt-2 text-[11px] font-medium text-brand-600 hover:underline"
                  >
                    + Add a variation (needs approval)
                  </button>
                ) : (
                  <form
                    action={addSubtask}
                    className="mt-2 space-y-2 rounded-md border border-brand-500/30 bg-brand-50 p-2 dark:bg-brand-500/10"
                  >
                    <input type="hidden" name="taskId" value={taskId} />
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Extra step</label>
                      <input name="title" required placeholder="e.g. Additional rockbreaking" className={`${inputClass} w-full`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-zinc-500">Duration</label>
                        <input name="estQty" type="number" min="0" step="0.5" className={`${inputClass} w-full`} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-zinc-500">Unit</label>
                        <select name="estUnit" defaultValue="days" className={`${inputClass} w-full`}>
                          <option value="hours">hours</option>
                          <option value="days">day(s)</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-zinc-500">Start</label>
                        <input type="date" name="plannedStartDate" min={taskStart ?? undefined} max={taskEnd ?? undefined} className={`${inputClass} w-full`} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-zinc-500">Cost ($)</label>
                        <input name="cost" type="number" min="0" step="0.01" className={`${inputClass} w-full`} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <SubmitButton variant="secondary" pendingText="Sending…">
                        Submit variation
                      </SubmitButton>
                      <button type="button" onClick={() => setVariationOpen(false)} className="text-sm text-zinc-500 hover:underline">
                        Cancel
                      </button>
                    </div>
                  </form>
                ))}
            </div>
          )}

          {/* Extension-of-time column */}
          {(extensionRequests.length > 0 || canRequestExtension || extensionPreStart) && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Extension of time</p>

              {extensionRequests.map((r) => (
                <div key={r.id} className="mt-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">New due: {r.proposedDueDate}</span>
                    <Badge tone={EXT_TONE[r.status]}>{r.status}</Badge>
                  </div>
                  {r.reason && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{r.reason}</p>}
                  {r.status === 'pending' && (
                    <ApprovalChain steps={extensionSteps[r.id] ?? []} viewerRole={viewerRole} path={path} />
                  )}
                </div>
              ))}

              {canRequestExtension && !hasPendingExt &&
                (!extensionOpen ? (
                  <button
                    type="button"
                    onClick={() => setExtensionOpen(true)}
                    className="mt-2 text-[11px] font-medium text-brand-600 hover:underline"
                  >
                    + Request an extension (needs approval)
                  </button>
                ) : (
                  <form
                    action={requestExtensionAction}
                    className="mt-2 space-y-2 rounded-md border border-brand-500/30 bg-brand-50 p-2 dark:bg-brand-500/10"
                  >
                    <input type="hidden" name="taskId" value={taskId} />
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Proposed new due date</label>
                      <input name="proposedDueDate" type="date" required min={taskEnd ?? undefined} className={`${inputClass} w-full`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Reason</label>
                      <input name="reason" placeholder="e.g. rain delays, material lead-time" className={`${inputClass} w-full`} />
                    </div>
                    <div className="flex gap-2">
                      <SubmitButton variant="secondary" pendingText="Sending…">
                        Request
                      </SubmitButton>
                      <button type="button" onClick={() => setExtensionOpen(false)} className="text-sm text-zinc-500 hover:underline">
                        Cancel
                      </button>
                    </div>
                    <FormError error={extErr.error} />
                  </form>
                ))}

              {extensionPreStart && extensionRequests.length === 0 && (
                <p className="mt-2 text-[11px] text-zinc-400">You can request an extension once the task is underway.</p>
              )}
            </div>
          )}
        </div>
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

    {/* Confirm + lock completion — completing a step is final. */}
    {confirmStep && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-6">
        <div className="w-[360px] rounded-2xl bg-white p-[22px] shadow-2xl dark:bg-zinc-900">
          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Mark step complete?</h4>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-zinc-500 dark:text-zinc-400">
            You’re marking <b className="text-zinc-900 dark:text-zinc-100">“{confirmStep.title}”</b> as complete. This
            can’t be undone — it locks the step and counts toward sign-off.
          </p>
          <div className="mt-[18px] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmStep(null)}
              className="h-[38px] rounded-lg border border-zinc-200 px-4 text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <form action={toggleSubtask} onSubmit={() => setConfirmStep(null)}>
              <input type="hidden" name="id" value={confirmStep.id} />
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="done" value="true" />
              <button
                type="submit"
                className="h-[38px] rounded-lg bg-green-600 px-[18px] text-[13.5px] font-semibold text-white hover:bg-green-700"
              >
                Yes, mark complete
              </button>
            </form>
          </div>
        </div>
      </div>
    )}

    {/* Submit for sign-off — popup */}
    {submitOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-6">
        <div className="w-[420px] rounded-2xl bg-white p-[22px] shadow-2xl dark:bg-zinc-900">
          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Submit for sign-off</h4>
          <p className="mt-1 text-[13px] leading-[1.55] text-zinc-500 dark:text-zinc-400">
            This sends the completed task to the project manager for approval.
          </p>
          <form action={submitTaskAction} className="mt-4 space-y-3">
            <input type="hidden" name="taskId" value={taskId} />
            <FormError error={submitState.error} />
            <div className="rounded-lg border border-zinc-200 transition focus-within:border-brand-500 dark:border-zinc-800">
              <textarea
                name="notes"
                rows={3}
                placeholder="What was completed?"
                className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <div className="flex items-center justify-between border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800">
                <MediaUploader
                  taskId={taskId}
                  projectId={projectId}
                  orgId={orgId}
                  purpose="completion"
                  accept="image/*,video/*,.pdf,.xls,.xlsx,.csv"
                  compact
                  glyph="📎"
                  label="Attach a photo, PDF or Excel (optional)"
                />
                <span className="pr-1 text-[10.5px] text-zinc-400">optional</span>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13.5px] text-zinc-700 dark:text-zinc-200">
              <input type="checkbox" name="declaration" className="h-[16px] w-[16px] accent-brand-600" />
              I confirm this work is complete and accurate.
            </label>
            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setSubmitOpen(false)}
                className="h-[38px] rounded-lg border border-zinc-200 px-4 text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <SubmitButton className="h-[38px]" pendingText="Submitting…">
                Submit
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Raise a blocker — popup */}
    {blockerOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-6">
        <div className="w-[420px] rounded-2xl bg-white p-[22px] shadow-2xl dark:bg-zinc-900">
          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Raise a blocker</h4>
          <p className="mt-1 text-[13px] leading-[1.55] text-zinc-500 dark:text-zinc-400">
            Pauses the task and flags it to the project manager. The deadline clock stops until it’s resolved.
          </p>
          <form action={raiseBlockerAction} className="mt-4 space-y-3">
            <input type="hidden" name="taskId" value={taskId} />
            <FormError error={blockerState.error} />
            <div className="rounded-lg border border-zinc-200 transition focus-within:border-brand-500 dark:border-zinc-800">
              <textarea
                name="description"
                rows={3}
                required
                placeholder="What's blocking you?"
                className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <div className="flex items-center border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800">
                <MediaUploader
                  taskId={taskId}
                  projectId={projectId}
                  orgId={orgId}
                  purpose="completion"
                  accept="image/*,video/*,.pdf,.xls,.xlsx,.csv"
                  compact
                  glyph="📎"
                  label="Attach a photo, PDF or Excel (optional)"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setBlockerOpen(false)}
                className="h-[38px] rounded-lg border border-zinc-200 px-4 text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex h-[38px] items-center justify-center rounded-lg bg-red-600 px-[18px] text-[13.5px] font-semibold text-white hover:bg-red-700"
              >
                Raise blocker
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
}
