'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatUsd } from '@datumpro/shared/domain';
import { awardTender, inviteTenderContractors, withdrawTenderInvite } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { TenderInvite, BidLine, TaskDoc } from '@/lib/data/tenders';

const STATUS_LABEL: Record<TenderInvite['status'], { label: string; cls: string }> = {
  invited: { label: 'Not submitted', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' },
  submitted: { label: 'Bid in', cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400' },
  awarded: { label: 'Awarded', cls: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
  not_selected: { label: 'Not selected', cls: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' },
};

export function TenderPanel({
  taskId,
  projectId,
  invites,
  bidLines,
  bidDocs,
  availableContractors,
  canManage,
  decided,
}: {
  taskId: string;
  projectId: string;
  invites: TenderInvite[];
  /** Each contractor's competing plan, keyed by contractorId. */
  bidLines: Record<string, BidLine[]>;
  /** Each contractor's BoQ/invoice docs, keyed by contractorId. */
  bidDocs: Record<string, TaskDoc[]>;
  availableContractors: { userId: string; name: string }[];
  canManage: boolean;
  /** True once the tender has been awarded. */
  decided: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const togglePick = (id: string) => setPicks((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // The PM's comparison. Contractors get their own bid-building view elsewhere.
  if (!canManage) {
    return (
      <Card>
        <CardTitle>Tender</CardTitle>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          You’re invited to bid on this task. Build your plan and price it below, then submit your bid.
        </p>
      </Card>
    );
  }

  const submittedCount = invites.filter((i) => i.status === 'submitted').length;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Tender</CardTitle>
        {!decided && (
          <span className="text-xs text-zinc-500">
            {submittedCount}/{invites.length} bid{invites.length === 1 ? '' : 's'} in
          </span>
        )}
      </div>

      {invites.length === 0 && <p className="mt-2 text-sm text-zinc-400">No contractors invited yet.</p>}

      <ul className="mt-3 space-y-2">
        {invites.map((inv) => {
          const meta = STATUS_LABEL[inv.status];
          const lines = bidLines[inv.contractorId] ?? [];
          const expandable = inv.status === 'submitted' || inv.status === 'awarded';
          return (
            <li key={inv.id} className="rounded-md border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  disabled={!expandable}
                  onClick={() => setOpen(open === inv.contractorId ? null : inv.contractorId)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate text-sm font-medium">{inv.contractorName}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                </button>
                {expandable && (
                  <span className="text-xs tabular-nums text-zinc-500">
                    {inv.bidLineCount} step{inv.bidLineCount === 1 ? '' : 's'} · {formatUsd(inv.bidTotalCents)}
                  </span>
                )}
                {!decided && inv.status !== 'awarded' && (
                  <form action={withdrawTenderInvite}>
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <button type="submit" className="text-[11px] text-zinc-400 hover:text-red-500" title="Remove invite">
                      ✕
                    </button>
                  </form>
                )}
              </div>

              {expandable && open === inv.contractorId && (
                <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <ul className="space-y-1">
                    {lines.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-zinc-700 dark:text-zinc-200">{l.title}</span>
                        <span className="flex-shrink-0 text-[11px] tabular-nums text-zinc-400">
                          {l.estQty ? `${l.estQty}${l.estUnit === 'hours' ? 'h' : 'd'}` : ''}
                          {l.plannedStartDate ? ` · ${l.plannedStartDate}` : ''} · {formatUsd(l.costCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {(bidDocs[inv.contractorId] ?? []).length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {(bidDocs[inv.contractorId] ?? []).map((d) => (
                        <li key={d.id}>
                          <a href={d.url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
                            <span aria-hidden>📄</span>
                            <span className="truncate">{d.filename}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <span className="text-sm font-semibold tabular-nums">Total {formatUsd(inv.bidTotalCents)}</span>
                    {!decided && inv.status === 'submitted' && (
                      <form action={awardTender}>
                        <input type="hidden" name="taskId" value={taskId} />
                        <input type="hidden" name="winnerId" value={inv.contractorId} />
                        <SubmitButton pendingText="Awarding…">Award to {inv.contractorName}</SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Invite more contractors (before award) */}
      {!decided && availableContractors.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {!inviteOpen ? (
            <button type="button" onClick={() => setInviteOpen(true)} className="text-[11px] font-medium text-brand-600 hover:underline">
              + Invite more contractors
            </button>
          ) : (
            <form action={inviteTenderContractors} className="space-y-2">
              <input type="hidden" name="taskId" value={taskId} />
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                {availableContractors.map((c) => (
                  <label key={c.userId} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <input type="checkbox" checked={picks.includes(c.userId)} onChange={() => togglePick(c.userId)} className="h-4 w-4 accent-brand-600" />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
              </div>
              {picks.map((id) => (
                <input key={id} type="hidden" name="contractorIds" value={id} />
              ))}
              <div className="flex gap-2">
                <SubmitButton variant="secondary" pendingText="Sending…" disabled={picks.length === 0}>
                  Send invitations
                </SubmitButton>
                <button type="button" onClick={() => setInviteOpen(false)} className="text-sm text-zinc-500 hover:underline">
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
