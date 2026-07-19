import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExtensionRequestForm } from './extension-request-form';
import { ApprovalChain } from '@/components/approvals/approval-chain';
import type { ApprovalStep } from '@/lib/data/approvals';
import type { ExtensionRequestRow } from '@/lib/data/tasks';

const STATUS_TONE = { pending: 'neutral', approved: 'green', rejected: 'amber', cancelled: 'neutral' } as const;

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
                  viewerRole={viewerRole}
                  path={`/projects/${projectId}/tasks/${taskId}`}
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
