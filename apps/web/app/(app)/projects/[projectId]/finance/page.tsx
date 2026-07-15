import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import { financeSummary } from '@/lib/data/finance';
import { listProjectPayments } from '@/lib/data/payments';
import { listProjectPaymentRequests } from '@/lib/data/payment-requests';
import { BudgetVsCost } from '@/components/finance/budget-vs-cost';
import { ManageRequest } from '@/components/payments/manage-request';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { can, type OrgRole } from '@datumpro/shared/access';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';

const REQ_TONE: Record<PaymentRequestStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  requested: 'amber',
  approved: 'blue',
  paid: 'green',
  rejected: 'neutral',
};

const PAY_STATUS = {
  pending: { tone: 'neutral', label: 'not claimed' },
  invoiced: { tone: 'blue', label: 'awaiting payment' },
  paid: { tone: 'green', label: 'paid' },
} as const;

export default async function FinancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const [summary, payments, orgRole, projectRole, paymentRequests] = await Promise.all([
    financeSummary(projectId),
    listProjectPayments(projectId),
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectPaymentRequests(projectId),
  ]);
  // The budget is the project's contract value; committed cost + payments track
  // against it (buy-side, request-and-pay — no client invoicing here).
  const budgetCents = project.contract_value_cents;
  const role = (orgRole ?? 'viewer') as OrgRole;
  // Reviewing contractor payment requests: org finance/admin/owner, or the PM.
  const canManagePayments = can(role, 'payment:record') || projectRole === 'pm';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finance</h1>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><CardTitle>Budget</CardTitle><CardValue>{formatUsd(budgetCents)}</CardValue></Card>
        <Card><CardTitle>Committed</CardTitle><CardValue>{formatUsd(summary.committedCostCents)}</CardValue></Card>
        <Card><CardTitle>Paid</CardTitle><CardValue>{formatUsd(summary.costToDateCents)}</CardValue></Card>
        <Card><CardTitle>Outstanding</CardTitle><CardValue>{formatUsd(summary.committedCostCents - summary.costToDateCents)}</CardValue></Card>
      </section>

      {(budgetCents > 0 || summary.committedCostCents > 0) && (
        <section className="mt-6">
          <BudgetVsCost
            budgetCents={budgetCents}
            committedCostCents={summary.committedCostCents}
            costToDateCents={summary.costToDateCents}
          />
        </section>
      )}

      {/* Contractor payment requests (buy-side; approve → pay → POP). Always shown
          to managers so the capability is visible before any request exists. */}
      {(canManagePayments || paymentRequests.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Payment requests</h2>
          {paymentRequests.length === 0 ? (
            <Card>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No payment requests yet. When a contractor requests payment (against a draw or as an
                invoice) from their <span className="font-medium">Payments &amp; documents</span> page,
                it appears here to approve, pay, and attach a proof of payment.
              </p>
            </Card>
          ) : (
          <Card className="p-0">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {paymentRequests.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="text-xs text-zinc-400">
                        {r.contractorName ?? 'Contractor'}
                        {r.invoiceUrl && (
                          <>
                            {' · '}
                            <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                              {r.invoiceName ?? 'invoice'}
                            </a>
                          </>
                        )}
                      </p>
                      {r.note && <p className="mt-1 text-xs text-zinc-500">“{r.note}”</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{formatUsd(r.amountCents)}</span>
                      <Badge tone={REQ_TONE[r.status]}>{PAYMENT_REQUEST_STATUS_LABEL[r.status]}</Badge>
                    </div>
                  </div>
                  {r.status === 'paid' && (
                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                      Paid{r.paidReference ? ` · ref ${r.paidReference}` : ''}
                      {r.popUrl && (
                        <>
                          {' · '}
                          <a href={r.popUrl} target="_blank" rel="noreferrer" className="underline">
                            POP
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {canManagePayments && (
                    <ManageRequest id={r.id} orgId={r.orgId} projectId={projectId} status={r.status} />
                  )}
                </li>
              ))}
            </ul>
          </Card>
          )}
        </section>
      )}

      {/* Contractor payments (buy-side; RLS shows only what the viewer may see) */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Contractor payments</h2>
        <Card>
          <div className="grid grid-cols-3 gap-4 border-b border-zinc-100 pb-4 dark:border-zinc-800">
            <div>
              <p className="text-xs text-zinc-500">Committed</p>
              <p className="text-lg font-semibold tabular-nums">{formatUsd(payments.summary.committedCents)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Paid</p>
              <p className="text-lg font-semibold tabular-nums">{formatUsd(payments.summary.paidCents)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Outstanding</p>
              <p className="text-lg font-semibold tabular-nums">{formatUsd(payments.summary.outstandingCents)}</p>
            </div>
          </div>
          {payments.lines.length === 0 ? (
            <p className="pt-4 text-sm text-zinc-500 dark:text-zinc-400">
              No contractor draws yet — they&apos;re generated when a quote is awarded.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 pt-2 dark:divide-zinc-800">
              {payments.lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    {l.taskId ? (
                      <Link href={`/projects/${projectId}/tasks/${l.taskId}`} className="font-medium hover:underline">
                        {l.taskTitle ?? 'Task'}
                      </Link>
                    ) : (
                      <span className="font-medium">{l.name}</span>
                    )}
                    <span className="ml-2 text-xs text-zinc-400">{l.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums">{formatUsd(l.amountCents)}</span>
                    <Badge tone={PAY_STATUS[l.status].tone}>{PAY_STATUS[l.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </main>
  );
}
