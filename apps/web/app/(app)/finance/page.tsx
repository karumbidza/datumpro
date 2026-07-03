import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/data/org';
import { can } from '@datumpro/shared/access';
import { orgFinanceOverview, orgReceivablesAging } from '@/lib/data/finance-portfolio';
import { ReceivablesAging } from '@/components/finance/receivables-aging';
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

/** Org-wide finance hub — the portfolio money view for owners, admins, finance
 *  and delivery PMs. Gated here and by RLS. Per-project detail lives at
 *  /projects/[id]/finance; this is the roll-up above it. */
export default async function OrgFinancePage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');

  // Owners, admins, finance and delivery PMs see the portfolio roll-up; RLS
  // still scopes the underlying rows to what each caller may read.
  const canView = can(ctx.active.role, 'finance:view') && ctx.active.role !== 'viewer';
  if (!canView) redirect('/dashboard');

  const [{ totals, collectionRate, projects }, aging] = await Promise.all([
    orgFinanceOverview(ctx.active.orgId),
    orgReceivablesAging(ctx.active.orgId, new Date()),
  ]);
  const withMoney = projects.filter(
    (p) => p.budgetCents || p.invoicedCents || p.paidCents || p.costToDateCents,
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finance</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Money across every project in {ctx.active.name}.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardTitle>Budget</CardTitle>
          <CardValue>{formatUsd(totals.budgetCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Invoiced</CardTitle>
          <CardValue>{formatUsd(totals.invoicedCents)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Collected</CardTitle>
          <CardValue>{formatUsd(totals.paidCents)}</CardValue>
          {collectionRate !== null && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {Math.round(collectionRate * 100)}% of invoiced
            </p>
          )}
        </Card>
        <Card>
          <CardTitle>Outstanding</CardTitle>
          <CardValue>{formatUsd(totals.outstandingCents)}</CardValue>
        </Card>
      </section>

      {aging.totalOutstandingCents > 0 && (
        <section className="mt-6">
          <ReceivablesAging aging={aging} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">By project</h2>
        {withMoney.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No budgets, invoices or payments recorded yet. Open a project&apos;s Finance tab to
              add a budget or raise an invoice.
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 text-right font-medium">Budget</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost to date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                  <th className="px-4 py-2.5 text-right font-medium">Collected</th>
                  <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
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
                    <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {formatUsd(p.costToDateCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatUsd(p.invoicedCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">
                      {formatUsd(p.paidCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatUsd(p.outstandingCents)}
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
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                    {formatUsd(totals.costToDateCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUsd(totals.invoicedCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">
                    {formatUsd(totals.paidCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUsd(totals.outstandingCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
