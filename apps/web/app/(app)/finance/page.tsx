import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/data/org';
import { can } from '@datumpro/shared/access';
import { orgContractorFinance } from '@/lib/data/finance-portfolio';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatUsd } from '@datumpro/shared/domain';

const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'amber'> = {
  active: 'blue',
  planning: 'neutral',
  on_hold: 'amber',
  completed: 'green',
  archived: 'neutral',
};

/** Org-wide finance hub — the portfolio contractor-payments view for owners,
 *  admins, finance and delivery PMs. Gated here and by RLS. Per-project detail
 *  (approve / pay / POP) lives at /projects/[id]/finance; this is the roll-up. */
export default async function OrgFinancePage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');

  const canView = can(ctx.active.role, 'finance:view');
  if (!canView) redirect('/dashboard');

  const { totals, projects } = await orgContractorFinance(ctx.active.orgId);
  const withMoney = projects.filter(
    (p) => p.budgetCents || p.committedCents || p.paidCents || p.pendingRequestsCount,
  );

  return (
    <PageContainer width="6xl">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finance</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Contractor payments across every project in {ctx.active.name}.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardTitle>Budget</CardTitle>
          <CardValue>{formatUsd(totals.budgetCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Committed</CardTitle>
          <CardValue>{formatUsd(totals.committedCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Paid</CardTitle>
          <CardValue>{formatUsd(totals.paidCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Outstanding</CardTitle>
          <CardValue>{formatUsd(totals.outstandingCents)}</CardValue>
        </Card>
      </section>

      {totals.pendingRequestsCount > 0 && (
        <section className="mt-6">
          <Card className="flex items-center justify-between gap-3 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {totals.pendingRequestsCount} payment request
                {totals.pendingRequestsCount === 1 ? '' : 's'} awaiting action
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                Open a project below to approve, pay, and attach a proof of payment.
              </p>
            </div>
            <span className="shrink-0 text-lg font-semibold tabular-nums text-amber-800 dark:text-amber-300">
              {formatUsd(totals.pendingRequestsCents)}
            </span>
          </Card>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">By project</h2>
        {withMoney.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No contractor commitments yet. When a task plan is approved, its agreed amount is committed
              here; contractors then invoice against it and you pay and attach a proof of payment.
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 text-right font-medium">Budget</th>
                  <th className="px-4 py-2.5 text-right font-medium">Committed</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                </tr>
              </thead>
              <tbody>
                {withMoney.map((p) => (
                  <tr
                    key={p.projectId}
                    className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${p.projectId}/finance`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="ml-2 align-middle">
                        <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>
                          {p.status.replace('_', ' ')}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                      {formatUsd(p.budgetCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatUsd(p.committedCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">
                      {formatUsd(p.paidCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatUsd(p.outstandingCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.pendingRequestsCount > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {p.pendingRequestsCount} · {formatUsd(p.pendingRequestsCents)}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium dark:border-zinc-700">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                    {formatUsd(totals.budgetCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUsd(totals.committedCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">
                    {formatUsd(totals.paidCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUsd(totals.outstandingCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totals.pendingRequestsCount > 0 ? formatUsd(totals.pendingRequestsCents) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
