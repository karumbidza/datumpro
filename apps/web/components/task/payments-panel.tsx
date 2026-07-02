import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  markPaymentPaid,
  submitPaymentClaim,
  rejectPaymentClaim,
} from '@/app/(app)/projects/[projectId]/tasks/actions';
import { formatUsd } from '@datumpro/shared/domain';
import type { PaymentLine, ScheduleStatus } from '@/lib/data/payments';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS: Record<ScheduleStatus, { tone: 'neutral' | 'blue' | 'green'; label: string }> = {
  pending: { tone: 'neutral', label: 'Not claimed' },
  invoiced: { tone: 'blue', label: 'Awaiting payment' },
  paid: { tone: 'green', label: 'Paid' },
};

/** Contractor progress payments for a task. Only rendered when there are draws
 *  (award generates them); RLS already limits who receives the data. The
 *  assignee can claim a pending draw; finance/PM pay or send a claim back. */
export function PaymentsPanel({
  taskId,
  lines,
  canManage,
  isAssignee = false,
}: {
  taskId: string;
  lines: PaymentLine[];
  canManage: boolean;
  isAssignee?: boolean;
}) {
  if (lines.length === 0) return null;

  const committed = lines.reduce((s, l) => s + l.amountCents, 0);
  const paid = lines.filter((l) => l.status === 'paid').reduce((s, l) => s + l.amountCents, 0);

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Payment schedule</CardTitle>
        <span className="text-xs text-zinc-500">
          {formatUsd(paid)} paid / {formatUsd(committed)}
        </span>
      </div>

      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {lines.map((l) => {
          const s = STATUS[l.status];
          return (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  {l.paidReference && (
                    <span className="ml-2 text-[11px] text-zinc-400">ref {l.paidReference}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatUsd(l.amountCents)}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
              </div>

              {l.status === 'invoiced' && l.claimNote && (
                <p className="mt-1 text-xs text-zinc-500">“{l.claimNote}”</p>
              )}

              {/* Contractor claims their own pending draw. */}
              {isAssignee && !canManage && l.status === 'pending' && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Claim payment
                  </summary>
                  <form action={submitPaymentClaim} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="scheduleId" value={l.id} />
                    <input type="hidden" name="taskId" value={taskId} />
                    <input name="note" placeholder="Optional note" className={`${inputClass} min-w-40 flex-1`} />
                    <Button type="submit" variant="secondary">Submit claim</Button>
                  </form>
                </details>
              )}

              {/* Finance/PM pay a draw, and send a claim back if needed. */}
              {canManage && l.status !== 'paid' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={markPaymentPaid} className="flex items-center gap-1">
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="scheduleId" value={l.id} />
                    <input name="reference" placeholder="ref" className={`${inputClass} w-20`} />
                    <Button type="submit" variant="secondary">Mark paid</Button>
                  </form>
                  {l.status === 'invoiced' && (
                    <form action={rejectPaymentClaim}>
                      <input type="hidden" name="taskId" value={taskId} />
                      <input type="hidden" name="scheduleId" value={l.id} />
                      <Button type="submit" variant="ghost">Reject claim</Button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
