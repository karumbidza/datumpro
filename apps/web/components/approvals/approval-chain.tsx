import { Button } from '@/components/ui/button';
import { decideApprovalStep } from '@/lib/actions/approvals';
import type { ApprovalStep } from '@/lib/data/approvals';

/** The earliest step still awaiting a decision (client-safe; no server imports). */
function currentStep(steps: ApprovalStep[]): ApprovalStep | null {
  return steps.find((s) => s.decision === 'pending') ?? null;
}

const ROLE_LABEL: Record<string, string> = {
  pm: 'PM',
  admin: 'Admin',
  owner: 'Owner',
  finance: 'Finance',
  member: 'Member',
  viewer: 'Viewer',
};

/** Which step roles a viewer can act on. Owner stands in for the management
 *  approval slots (admin/finance) but NOT for the PM's own step — a later
 *  approver can never jump the earlier one. */
const COVERS: Record<string, string[]> = {
  owner: ['owner', 'admin', 'finance'],
  admin: ['admin', 'finance'],
  finance: ['finance'],
  pm: ['pm'],
  member: ['member'],
  viewer: ['viewer'],
};
function canFulfill(viewerRole: string, stepRole: string): boolean {
  return (COVERS[viewerRole] ?? [viewerRole]).includes(stepRole);
}

/** The shared multi-step chain UI for any approvable item (task plan/variation,
 *  extension, payment, request). Approval is SEQUENTIAL: only the earliest pending
 *  step is actionable. A later approver (e.g. Admin behind PM) sees a greyed
 *  "Pending … approval" until it's their turn. `path` is revalidated after a
 *  decision. */
export function ApprovalChain({
  steps,
  viewerRole,
  path,
}: {
  steps: ApprovalStep[];
  viewerRole: string;
  path: string;
}) {
  if (steps.length === 0) return null;
  const active = currentStep(steps); // earliest pending — the only actionable step
  // The pending step this viewer is responsible for (if any).
  const myStep = steps.find((s) => s.decision === 'pending' && canFulfill(viewerRole, s.approverRole));
  const canActNow = !!active && !!myStep && myStep.id === active.id;
  // The viewer's turn hasn't come — an earlier step is still pending.
  const waitingForEarlier = !!myStep && !!active && myStep.id !== active.id;

  return (
    <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {steps.map((s, i) => (
          <span key={s.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">→</span>}
            <span
              className={
                s.decision === 'approved'
                  ? 'text-green-600 dark:text-green-400'
                  : s.decision === 'rejected'
                    ? 'text-amber-600 dark:text-amber-400'
                    : s.id === active?.id
                      ? 'font-medium text-zinc-600 dark:text-zinc-300'
                      : 'text-zinc-400'
              }
            >
              {s.decision === 'approved' ? '✓' : s.decision === 'rejected' ? '✕' : '○'}{' '}
              {ROLE_LABEL[s.approverRole] ?? s.approverRole}
              {s.approverName ? ` · ${s.approverName}` : ''}
            </span>
          </span>
        ))}
      </div>

      {canActNow && active && (
        <div className="mt-2 flex gap-2">
          <form action={decideApprovalStep}>
            <input type="hidden" name="approvalId" value={active.id} />
            <input type="hidden" name="path" value={path} />
            <Button type="submit" name="decision" value="approved">
              Approve ({ROLE_LABEL[active.approverRole] ?? active.approverRole})
            </Button>
          </form>
          <form action={decideApprovalStep}>
            <input type="hidden" name="approvalId" value={active.id} />
            <input type="hidden" name="path" value={path} />
            <Button type="submit" name="decision" value="rejected" variant="secondary">
              Reject
            </Button>
          </form>
        </div>
      )}

      {waitingForEarlier && active && (
        <div className="mt-2">
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
          >
            Approve
          </button>
          <p className="mt-1 text-[11px] text-zinc-400">
            Pending {ROLE_LABEL[active.approverRole] ?? active.approverRole} approval
          </p>
        </div>
      )}
    </div>
  );
}
