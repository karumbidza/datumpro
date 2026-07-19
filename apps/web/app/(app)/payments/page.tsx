import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { listMyPayments, type MyPaymentLine } from '@/lib/data/payments';
import { submitPaymentClaim } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';
import { listMyPaymentRequests, listMyRequestProjects } from '@/lib/data/payment-requests';
import { RequestPaymentForm } from '@/components/payments/request-payment-form';
import {
  CONTRACTOR_DOC_TYPE_LABEL,
  CONTRACTOR_DOC_STATUS_LABEL,
  type ContractorDocStatus,
} from '@datumpro/shared/domain';
import { listMyDocuments, listMyOrgs } from '@/lib/data/contractor-documents';
import { UploadDocumentForm } from '@/components/documents/upload-document-form';

const REQ_TONE: Record<PaymentRequestStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  requested: 'amber',
  approved: 'blue',
  paid: 'green',
  rejected: 'neutral',
};

const DOC_TONE: Record<ContractorDocStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  submitted: 'amber',
  verified: 'green',
  rejected: 'neutral',
};

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS: Record<MyPaymentLine['status'], { tone: 'neutral' | 'blue' | 'green'; label: string }> = {
  pending: { tone: 'neutral', label: 'Not claimed' },
  invoiced: { tone: 'blue', label: 'Awaiting payment' },
  paid: { tone: 'green', label: 'Paid' },
};

export default async function MyPaymentsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const { lines, summary } = await listMyPayments(user.id);
  const [{ rows: requests }, requestProjects, documents, myOrgs] = await Promise.all([
    listMyPaymentRequests(user.id),
    listMyRequestProjects(user.id),
    listMyDocuments(user.id),
    listMyOrgs(user.id),
  ]);
  // Pending draws can be requested against (pre-fills the form).
  const draws = lines
    .filter((l) => l.status === 'pending')
    .map((l) => ({ id: l.id, projectId: l.projectId, name: l.name, amountCents: l.amountCents }));

  // Group draws under their project for a readable statement.
  const byProject = new Map<string, { name: string; lines: MyPaymentLine[] }>();
  for (const l of lines) {
    const g = byProject.get(l.projectId) ?? { name: l.projectName, lines: [] };
    g.lines.push(l);
    byProject.set(l.projectId, g);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payments &amp; documents</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Your progress draws across every project. Claim a draw when the work it covers is done — your
        project manager reviews and pays it.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardTitle>Earned</CardTitle>
          <CardValue>{formatUsd(summary.earnedCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Awaiting payment</CardTitle>
          <CardValue>{formatUsd(summary.claimedCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Paid</CardTitle>
          <CardValue>{formatUsd(summary.paidCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Outstanding</CardTitle>
          <CardValue>{formatUsd(summary.outstandingCents)}</CardValue>
        </Card>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Payment requests</h2>
          <RequestPaymentForm projects={requestProjects} draws={draws} />
        </div>
        {requests.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No requests yet. Raise one to invoice for a scheduled draw or ad-hoc work — attach your
              invoice, and track it through approval to payment here.
            </p>
          </Card>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {requests.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-zinc-400">
                      {r.projectName}
                      {r.invoiceUrl && (
                        <>
                          {' · '}
                          <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                            {r.invoiceName ?? 'invoice'}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">{formatUsd(r.amountCents)}</span>
                    <Badge tone={REQ_TONE[r.status]}>{PAYMENT_REQUEST_STATUS_LABEL[r.status]}</Badge>
                  </div>
                </div>
                {r.status === 'rejected' && r.reviewNote && (
                  <p className="mt-1 text-xs text-zinc-500">Rejected — “{r.reviewNote}”</p>
                )}
                {r.status === 'paid' && (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                    Paid{r.paidReference ? ` · ref ${r.paidReference}` : ''}
                    {r.popUrl && (
                      <>
                        {' · '}
                        <a href={r.popUrl} target="_blank" rel="noreferrer" className="underline">
                          proof of payment
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Compliance documents</h2>
            <p className="text-xs text-zinc-400">
              Tax clearances, company registration, insurance — visible only to you and the admins.
            </p>
          </div>
          <UploadDocumentForm orgs={myOrgs} />
        </div>
        {documents.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents on file yet.</p>
          </Card>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {d.title || CONTRACTOR_DOC_TYPE_LABEL[d.docType]}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {CONTRACTOR_DOC_TYPE_LABEL[d.docType]}
                    {d.expiryDate ? ` · expires ${d.expiryDate}` : ''}
                    {d.fileUrl && (
                      <>
                        {' · '}
                        <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                          view
                        </a>
                      </>
                    )}
                  </p>
                  {d.status === 'rejected' && d.reviewNote && (
                    <p className="mt-0.5 text-xs text-red-500">Rejected — “{d.reviewNote}”</p>
                  )}
                </div>
                <Badge tone={DOC_TONE[d.status]}>{CONTRACTOR_DOC_STATUS_LABEL[d.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <h2 className="mb-3 mt-10 text-sm font-semibold">Scheduled draws</h2>
      {lines.length === 0 ? (
        <Card className="mt-8">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No draws yet. When you&apos;re awarded a task, its payment schedule appears here and you can
            claim each draw as you complete the work.
          </p>
        </Card>
      ) : (
        <div className="mt-8 space-y-6">
          {[...byProject.entries()].map(([projectId, group]) => (
            <section key={projectId}>
              <h2 className="mb-2 text-sm font-semibold">{group.name}</h2>
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
                {group.lines.map((l) => {
                  const s = STATUS[l.status];
                  return (
                    <div key={l.id} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          {l.taskId ? (
                            <Link
                              href={`/projects/${projectId}/tasks/${l.taskId}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {l.taskTitle ?? 'Task'}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium">{l.name}</span>
                          )}
                          <span className="ml-2 text-xs text-zinc-400">{l.name}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatUsd(l.amountCents)}
                          </span>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </div>
                      </div>

                      {l.status === 'invoiced' && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Claimed {fmtDate(l.claimedAt)}
                          {l.claimNote ? ` · “${l.claimNote}”` : ''}
                        </p>
                      )}
                      {l.status === 'paid' && (
                        <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                          Paid {fmtDate(l.paidAt)}
                          {l.paidReference ? ` · ref ${l.paidReference}` : ''}
                        </p>
                      )}
                      {l.status === 'pending' && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                            Claim payment
                          </summary>
                          <form action={submitPaymentClaim} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="scheduleId" value={l.id} />
                            <input type="hidden" name="taskId" value={l.taskId ?? ''} />
                            <input
                              name="note"
                              placeholder="Optional note (e.g. milestone reached)"
                              className={`${inputClass} min-w-48 flex-1`}
                            />
                            <Button type="submit" variant="secondary">
                              Submit claim
                            </Button>
                          </form>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
