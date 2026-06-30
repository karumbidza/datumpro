import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getInvoiceDetail } from '@/lib/data/finance';
import { recordPayment, submitPop, verifyPop } from '../../actions';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUsd, PAYMENT_METHODS } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';
const INVOICE_TONE = { paid: 'green', part_paid: 'blue', sent: 'blue', overdue: 'amber', draft: 'neutral', void: 'neutral' } as const;
const POP_TONE = { verified: 'green', submitted: 'blue', rejected: 'amber' } as const;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; invoiceId: string }>;
}) {
  const { projectId, invoiceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const detail = await getInvoiceDetail(invoiceId);
  if (!detail) notFound();
  const { invoice, lines, payments, pops } = detail;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}/finance`} className="text-xs text-zinc-500 hover:underline">
        ← Finance
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{invoice.number}</h1>
          {invoice.due_date && <p className="text-sm text-zinc-500">Due {invoice.due_date}</p>}
        </div>
        <Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status.replace('_', ' ')}</Badge>
      </div>

      <Card className="mt-6">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {l.description} <span className="text-zinc-400">× {l.quantity}</span>
              </span>
              <span className="tabular-nums">{formatUsd(l.amount_cents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-zinc-100 pt-3 text-sm font-semibold dark:border-zinc-800">
          <span>Total</span>
          <span className="tabular-nums">{formatUsd(invoice.total_cents)}</span>
        </div>
      </Card>

      <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardTitle>Payments</CardTitle>
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">None recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span className="text-zinc-500">{p.method.replace('_', ' ')}</span>
                  <span className="tabular-nums">{formatUsd(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <form action={recordPayment} className="mt-4 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input name="amount" type="number" step="0.01" placeholder="Amount $" required className={inputClass} />
            <select name="method" className={inputClass} defaultValue="bank_transfer">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace('_', ' ')}</option>
              ))}
            </select>
            <input name="reference" placeholder="Reference (optional)" className={inputClass} />
            <Button type="submit" variant="secondary">Record payment</Button>
          </form>
        </Card>

        <Card>
          <CardTitle>Proof of payment</CardTitle>
          {pops.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">None submitted.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {pops.map((pop) => (
                <li key={pop.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-zinc-600 dark:text-zinc-300">{pop.storage_path}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={POP_TONE[pop.status]}>{pop.status}</Badge>
                    {pop.status === 'submitted' && (
                      <form action={verifyPop}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="invoiceId" value={invoiceId} />
                        <input type="hidden" name="popId" value={pop.id} />
                        <button type="submit" className="text-xs text-brand-500 hover:underline">verify</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={submitPop} className="mt-4 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input name="reference" placeholder="Document reference / bank ref" required className={inputClass} />
            <input name="note" placeholder="Note (optional)" className={inputClass} />
            <Button type="submit" variant="secondary">Submit POP</Button>
          </form>
        </Card>
      </section>
    </main>
  );
}
