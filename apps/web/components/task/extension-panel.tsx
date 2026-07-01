import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requestExtension, decideExtension } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { ExtensionRequestRow } from '@/lib/data/tasks';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

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

      {canRequest && !hasPending && (
        <form
          action={requestExtension}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <div>
            <label className="mb-1 block text-xs font-medium">Proposed new due date</label>
            <input name="proposedDueDate" type="date" required className={inputClass} />
          </div>
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs font-medium">Reason</label>
            <input name="reason" placeholder="e.g. rain delays, material lead-time" className={inputClass} />
          </div>
          <Button type="submit">Request extension</Button>
        </form>
      )}
    </Card>
  );
}
