import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listMyPayments, type MyPaymentLine } from '@/lib/data/payments';
import { submitPaymentClaim } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { lines, summary } = await listMyPayments(user.id);

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
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">My payments</h1>
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
