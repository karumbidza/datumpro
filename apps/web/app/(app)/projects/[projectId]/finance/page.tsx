import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import { financeSummary } from '@/lib/data/finance';
import { listProjectPaymentRequests } from '@/lib/data/payment-requests';
import { getProjectRetention } from '@/lib/data/retention';
import { BudgetVsCost } from '@/components/finance/budget-vs-cost';
import { ManageRequest } from '@/components/payments/manage-request';
import { RecordDeductionForm } from '@/components/payments/record-deduction-form';
import { stepsByEntity } from '@/lib/data/approvals';
import { LiveRefresh } from '@/components/live-refresh';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PAYMENT_REQUEST_TONE } from '@/components/ui/tones';
import { can, type OrgRole } from '@datumpro/shared/access';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, PAYMENT_REQUEST_KIND_LABEL } from '@datumpro/shared/domain';

export default async function FinancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const [summary, orgRole, projectRole, paymentRequests, retention] = await Promise.all([
    financeSummary(projectId),
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectPaymentRequests(projectId),
    getProjectRetention(projectId),
  ]);
  const paymentSteps = await stepsByEntity('payment', paymentRequests.map((r) => r.id));
  // The budget is the project's contract value; committed cost + payments track
  // against it (buy-side, request-and-pay — no client invoicing here).
  const budgetCents = project.contract_value_cents;
  const role = (orgRole ?? 'viewer') as OrgRole;
  // Reviewing contractor payment requests: org finance/admin/owner, or the PM.
  const canManagePayments = can(role, 'payment:record') || projectRole === 'pm';

  return (
    <PageContainer width="6xl">
      <LiveRefresh
        subscriptions={[
          { table: 'contractor_payment_requests', filter: `project_id=eq.${projectId}` },
          { table: 'approvals', filter: `org_id=eq.${project.org_id}` },
        ]}
      />
      <PageHeader backHref={`/projects/${projectId}`} backLabel={project.name} title="Finance" />

      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><CardTitle>Budget</CardTitle><CardValue>{formatUsd(budgetCents)}</CardValue></Card>
        <Card><CardTitle>Committed</CardTitle><CardValue>{formatUsd(summary.committedCostCents)}</CardValue></Card>
        <Card><CardTitle>Paid</CardTitle><CardValue>{formatUsd(summary.costToDateCents)}</CardValue></Card>
        <Card><CardTitle>Outstanding</CardTitle><CardValue>{formatUsd(summary.committedCostCents - summary.costToDateCents)}</CardValue></Card>
      </section>

      {(budgetCents > 0 || summary.committedCostCents > 0) && (
        <section className="mt-8">
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
                      <p className="truncate text-sm font-medium">
                        {r.title}
                        {r.kind === 'retention' && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            {PAYMENT_REQUEST_KIND_LABEL.retention}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        {r.contractorName ?? 'Contractor'}
                        {r.invoiceUrl && (
                          <>
                            {' · '}
                            <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="text-brand-600 dark:text-brand-400 hover:underline dark:text-brand-400">
                              {r.invoiceName ?? 'invoice'}
                            </a>
                          </>
                        )}
                      </p>
                      {r.note && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">“{r.note}”</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{formatUsd(r.amountCents)}</span>
                      <Badge tone={PAYMENT_REQUEST_TONE[r.status]}>{PAYMENT_REQUEST_STATUS_LABEL[r.status]}</Badge>
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
                    <ManageRequest
                      id={r.id}
                      orgId={r.orgId}
                      projectId={projectId}
                      status={r.status}
                      steps={paymentSteps.get(r.id) ?? []}
                      viewerRole={orgRole ?? ''}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
          )}
        </section>
      )}

      {/* Retention held back, spent on repairs, and released (per contractor). */}
      {retention && (retention.contractors.length > 0 || retention.practicalCompletionAt) && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Retention</h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {retention.practicalCompletionAt
                  ? retention.releasable
                    ? 'Defects-liability period elapsed — contractors may now release the balance.'
                    : `Releasable from ${fmtDate(retention.releaseAt)} (defects-liability period).`
                  : 'Held back from progress claims. Becomes releasable after the defects-liability period following practical completion.'}
              </p>
            </div>
            {canManagePayments && (
              <RecordDeductionForm
                projectId={projectId}
                contractors={retention.contractors
                  .filter((c) => c.availableCents > 0)
                  .map((c) => ({
                    contractorId: c.contractorId,
                    contractorName: c.contractorName,
                    availableCents: c.availableCents,
                  }))}
              />
            )}
          </div>

          {retention.contractors.length === 0 ? (
            <Card>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No retention held yet.</p>
            </Card>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {retention.contractors.map((c) => (
                  <li key={c.contractorId} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{c.contractorName ?? 'Contractor'}</p>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatUsd(c.availableCents)} <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">available</span>
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>Held {formatUsd(c.withheldCents)}</span>
                      {c.deductedCents > 0 && (
                        <span className="text-red-600 dark:text-red-400">Repairs {formatUsd(c.deductedCents)}</span>
                      )}
                      {c.claimedCents > 0 && <span>Released/claimed {formatUsd(c.claimedCents)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {retention.deductions.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Retention spent on repairs</h3>
              <Card className="p-0">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {retention.deductions.map((d) => (
                    <li key={d.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{d.reason}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {d.contractorName ?? 'Contractor'} · {fmtDate(d.createdAt)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-red-600 dark:text-red-400">
                        −{formatUsd(d.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </section>
      )}

    </PageContainer>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
