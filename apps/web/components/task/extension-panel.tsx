import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { decideExtension } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { ExtensionRequestForm } from './extension-request-form';
import type { ExtensionRequestRow } from '@/lib/data/tasks';

const STATUS_TONE = { pending: 'neutral', approved: 'green', rejected: 'amber', cancelled: 'neutral' } as const;

export function ExtensionPanel({
  taskId,
  canManage,
  canRequest,
  requests,
}: {
  taskId: string;
  canManage: boolean;
  canRequest: boolean;
  requests: ExtensionRequestRow[];
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
            <li
              key={r.id}
              className="rounded-md border border-zinc-100 p-2 text-sm dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">New due: {r.proposedDueDate}</span>
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              </div>
              {r.reason && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{r.reason}</p>}
              <p className="mt-1 text-[11px] text-zinc-400">
                {r.requesterName ?? 'Member'} · {new Date(r.createdAt).toLocaleDateString()}
              </p>
              {r.status === 'pending' && canManage && (
                <div className="mt-2 flex gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <form action={decideExtension}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <Button type="submit" name="decision" value="approve">Approve</Button>
                  </form>
                  <form action={decideExtension}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <Button type="submit" name="decision" value="reject" variant="secondary">Reject</Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canRequest && !hasPending && <ExtensionRequestForm taskId={taskId} />}
    </Card>
  );
}
