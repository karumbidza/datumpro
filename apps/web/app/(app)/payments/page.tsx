import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { listMyOwed } from '@/lib/data/owed';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';
import { listMyPaymentRequests } from '@/lib/data/payment-requests';
import { RequestPaymentForm, type RequestTask } from '@/components/payments/request-payment-form';
import {
  CONTRACTOR_DOC_TYPE_LABEL,
  CONTRACTOR_DOC_STATUS_LABEL,
  type ContractorDocStatus,
} from '@datumpro/shared/domain';
import { listMyDocuments, listMyOrgs } from '@/lib/data/contractor-documents';
import { UploadDocumentForm } from '@/components/documents/upload-document-form';
import { LiveRefresh } from '@/components/live-refresh';

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

export default async function MyPaymentsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const { tasks: owed, summary } = await listMyOwed(user.id);
  const [{ rows: requests }, documents, myOrgs] = await Promise.all([
    listMyPaymentRequests(user.id),
    listMyDocuments(user.id),
    listMyOrgs(user.id),
  ]);

  const requestTasks: RequestTask[] = owed.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    projectId: t.projectId,
    orgId: t.orgId,
    projectName: t.projectName,
    requestableCents: t.requestableCents,
  }));

  return (
    <PageContainer width="4xl">
      <LiveRefresh
        subscriptions={[{ table: 'contractor_payment_requests', filter: `contractor_id=eq.${user.id}` }]}
      />
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payments &amp; documents</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        What you&apos;re owed on your approved plans. Raise a payment request against a task, attach your
        invoice, and track it through to payment.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardTitle>Earned</CardTitle>
          <CardValue>{formatUsd(summary.earnedCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Awaiting payment</CardTitle>
          <CardValue>{formatUsd(summary.awaitingCents)}</CardValue>
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

      {/* What you're owed — per approved task */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">What you&apos;re owed</h2>
          <RequestPaymentForm tasks={requestTasks} />
        </div>
        {owed.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nothing yet. Once a plan you priced is approved and the work is yours, the agreed amount shows
              here and you can invoice against it.
            </p>
          </Card>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {owed.map((t) => (
              <div key={t.taskId} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${t.projectId}/tasks/${t.taskId}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <p className="text-xs text-zinc-400">{t.projectName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatUsd(t.outstandingCents)}</p>
                    <p className="text-[11px] text-zinc-400">outstanding</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                  <span>Committed {formatUsd(t.committedCents)}</span>
                  <span className="text-green-600 dark:text-green-400">Paid {formatUsd(t.paidCents)}</span>
                  {t.pendingCents > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">In review {formatUsd(t.pendingCents)}</span>
                  )}
                  {t.requestableCents > 0 && <span>Claimable {formatUsd(t.requestableCents)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Payment request history */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Payment requests</h2>
        {requests.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No requests yet. Use “Request payment” above to invoice against an approved task.
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
    </PageContainer>
  );
}
