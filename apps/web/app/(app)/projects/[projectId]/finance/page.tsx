import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listBudgetBilling, listInvoices, financeSummary } from '@/lib/data/finance';
import { listProjectPayments } from '@/lib/data/payments';
import { addBudgetLine } from './actions';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';

const PAY_TONE = { paid: 'green', invoiced: 'blue', pending: 'neutral' } as const;

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const INVOICE_TONE = { paid: 'green', part_paid: 'blue', sent: 'blue', overdue: 'amber', draft: 'neutral', void: 'neutral' } as const;

export default async function FinancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const [summary, budget, invoices, payments] = await Promise.all([
    financeSummary(projectId),
    listBudgetBilling(projectId),
    listInvoices(projectId),
    listProjectPayments(projectId),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finance</h1>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><CardTitle>Budget</CardTitle><CardValue>{formatUsd(summary.budgetCents)}</CardValue></Card>
        <Card><CardTitle>Invoiced</CardTitle><CardValue>{formatUsd(summary.invoicedCents)}</CardValue></Card>
        <Card><CardTitle>Paid</CardTitle><CardValue>{formatUsd(summary.paidCents)}</CardValue></Card>
        <Card><CardTitle>Outstanding</CardTitle><CardValue>{formatUsd(summary.outstandingCents)}</CardValue></Card>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold">Budget / BOQ</h2>
          <Card>
            {budget.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No budget lines yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {budget.map((b) => {
                  const pct = b.budgetCents > 0 ? Math.min(100, (b.billedCents / b.budgetCents) * 100) : 0;
                  const over = b.remainingCents < 0;
                  return (
                    <li key={b.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{b.description}</span>
                        <span className="shrink-0 tabular-nums text-zinc-500">
                          {formatUsd(b.budgetCents)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-brand-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                          {formatUsd(b.billedCents)} billed
                          {over && <span className="text-amber-600 dark:text-amber-400"> · over</span>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={addBudgetLine} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <input type="hidden" name="projectId" value={projectId} />
              <input name="description" required placeholder="Line item" className={`${inputClass} flex-1 min-w-32`} />
              <input name="quantity" type="number" step="0.01" defaultValue={1} className={`${inputClass} w-20`} title="Qty" />
              <input name="rate" type="number" step="0.01" placeholder="Rate $" className={`${inputClass} w-24`} />
              <Button type="submit" variant="secondary">Add</Button>
            </form>
          </Card>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Invoices</h2>
            <Link href={`/projects/${projectId}/finance/invoices/new`}>
              <Button>New invoice</Button>
            </Link>
          </div>
          {invoices.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No invoices yet.</p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/projects/${projectId}/finance/invoices/${inv.id}`}>
                    <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                      <div>
                        <p className="text-sm font-medium">{inv.number}</p>
                        <p className="text-xs text-zinc-400">{inv.issue_date}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm tabular-nums">{formatUsd(inv.total_cents)}</span>
                        <Badge tone={INVOICE_TONE[inv.status]}>{inv.status.replace('_', ' ')}</Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

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
                    <Badge tone={PAY_TONE[l.status]}>{l.status}</Badge>
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
