import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getRequestDetail } from '@/lib/data/requests';
import { myOrgRole } from '@/lib/data/tasks';
import { submitRequest, decideApproval } from '../actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';
const STATUS_TONE = { approved: 'green', submitted: 'blue', rejected: 'amber', draft: 'neutral', cancelled: 'neutral' } as const;
const DECISION_TONE = { approved: 'green', rejected: 'amber', pending: 'neutral' } as const;
const LEAD_ROLES = ['owner', 'admin', 'pm'];

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; requestId: string }>;
}) {
  const { projectId, requestId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const detail = await getRequestDetail(requestId);
  if (!detail) notFound();
  const { request, approvals } = detail;
  const role = await myOrgRole(request.org_id);

  const isRequester = request.raised_by === user.id;
  const canSubmit = request.status === 'draft' && (isRequester || (!!role && LEAD_ROLES.includes(role)));
  const canDecide = (approverRole: string) =>
    !!role && (role === approverRole || role === 'owner' || role === 'admin');

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}/requests`} className="text-xs text-zinc-500 hover:underline">
        ← Requests
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-zinc-400">{request.type}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{request.title}</h1>
        </div>
        <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
      </div>

      <Card className="mt-6 space-y-2 text-sm">
        {request.amount_cents != null && (
          <div className="flex justify-between">
            <span className="text-zinc-500">Amount</span>
            <span className="font-medium tabular-nums">{formatUsd(request.amount_cents)}</span>
          </div>
        )}
        {request.description && <p className="text-zinc-600 dark:text-zinc-300">{request.description}</p>}
      </Card>

      {canSubmit && (
        <form action={submitRequest} className="mt-6">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit">Submit for approval</Button>
        </form>
      )}

      {approvals.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Approval chain</h2>
          <ol className="space-y-3">
            {approvals.map((a) => (
              <li key={a.id}>
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      Step {a.step_order} · <span className="text-zinc-500">{a.approver_role}</span>
                    </span>
                    <Badge tone={DECISION_TONE[a.decision]}>{a.decision}</Badge>
                  </div>
                  {a.comment && <p className="mt-1 text-xs text-zinc-500">{a.comment}</p>}

                  {a.decision === 'pending' && canDecide(a.approver_role) && !isRequester && (
                    <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <form action={decideApproval} className="space-y-2">
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="requestId" value={requestId} />
                        <input type="hidden" name="approvalId" value={a.id} />
                        <input name="comment" placeholder="Comment (optional)" className={inputClass} />
                        <div className="flex gap-2">
                          <Button type="submit" name="decision" value="approved">Approve</Button>
                          <Button type="submit" name="decision" value="rejected" variant="secondary">Reject</Button>
                        </div>
                      </form>
                    </div>
                  )}
                  {a.decision === 'pending' && isRequester && (
                    <p className="mt-2 text-xs text-zinc-400">You can&apos;t approve your own request.</p>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
