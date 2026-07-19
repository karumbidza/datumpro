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

/** The shared two-step chain UI for any approvable item (extension, payment,
 *  variation, request). Renders "✓ PM · ⌛ Admin" and shows Approve/Reject to
 *  whoever's step is current (owners/admins can act on any step). `path` is the
 *  page to revalidate after a decision. */
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
  const active = currentStep(steps);
  const canDecide =
    !!active && (viewerRole === active.approverRole || viewerRole === 'owner' || viewerRole === 'admin');

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
                    : 'text-zinc-400'
              }
            >
              {s.decision === 'approved' ? '✓' : s.decision === 'rejected' ? '✕' : '⌛'}{' '}
              {ROLE_LABEL[s.approverRole] ?? s.approverRole}
              {s.approverName ? ` · ${s.approverName}` : ''}
            </span>
          </span>
        ))}
      </div>
      {canDecide && active && (
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
    </div>
  );
}
