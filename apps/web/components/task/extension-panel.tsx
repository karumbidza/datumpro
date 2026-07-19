import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { decideApprovalStep } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { ExtensionRequestForm } from './extension-request-form';
import { currentStep, type ApprovalStep } from '@/lib/data/approvals';
import type { ExtensionRequestRow } from '@/lib/data/tasks';

const STATUS_TONE = { pending: 'neutral', approved: 'green', rejected: 'amber', cancelled: 'neutral' } as const;
const ROLE_LABEL: Record<string, string> = {
  pm: 'PM',
  admin: 'Admin',
  owner: 'Owner',
  finance: 'Finance',
  member: 'Member',
  viewer: 'Viewer',
};

/** The two-step chain for one item: PM → Admin, with the decide buttons shown to
 *  whoever's step is current (owners/admins can act on any step). */
function ApprovalChain({
  steps,
  projectId,
  taskId,
  viewerRole,
}: {
  steps: ApprovalStep[];
  projectId: string;
  taskId: string;
  viewerRole: string;
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
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <Button type="submit" name="decision" value="approved">
              Approve ({ROLE_LABEL[active.approverRole] ?? active.approverRole})
            </Button>
          </form>
          <form action={decideApprovalStep}>
            <input type="hidden" name="approvalId" value={active.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <Button type="submit" name="decision" value="rejected" variant="secondary">
              Reject
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

export function ExtensionPanel({
  taskId,
  projectId,
  canRequest,
  requests,
  stepsByExt,
  viewerRole,
}: {
  taskId: string;
  projectId: string;
  canRequest: boolean;
  requests: ExtensionRequestRow[];
  stepsByExt: Record<string, ApprovalStep[]>;
  viewerRole: string;
}) {
  const hasPending = requests.some((r) => r.status === 'pending');

  return (
    <Card className="mt-6">
      <CardTitle>Extension requests</CardTitle>

      {requests.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No extension requests.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {requests.map((r) => (
            <li key={r.id} className="rounded-md border border-zinc-100 p-2 text-sm dark:border-zinc-800">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">New due: {r.proposedDueDate}</span>
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              </div>
              {r.reason && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{r.reason}</p>}
              <p className="mt-1 text-[11px] text-zinc-400">
                {r.requesterName ?? 'Member'} · {new Date(r.createdAt).toLocaleDateString()}
              </p>
              {r.status === 'pending' && (
                <ApprovalChain
                  steps={stepsByExt[r.id] ?? []}
                  projectId={projectId}
                  taskId={taskId}
                  viewerRole={viewerRole}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canRequest && !hasPending && <ExtensionRequestForm taskId={taskId} />}
    </Card>
  );
}
