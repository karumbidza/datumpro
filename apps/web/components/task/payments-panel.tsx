import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { markPaymentPaid } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { formatUsd } from '@datumpro/shared/domain';
import type { PaymentLine, ScheduleStatus } from '@/lib/data/payments';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS_TONE: Record<ScheduleStatus, 'neutral' | 'blue' | 'green'> = {
  pending: 'neutral',
  invoiced: 'blue',
  paid: 'green',
};

/** Contractor progress payments for a task. Only rendered when there are draws
 *  (award generates them); RLS already limits who receives the data. */
export function PaymentsPanel({
  taskId,
  lines,
  canManage,
}: {
  taskId: string;
  lines: PaymentLine[];
  canManage: boolean;
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
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{l.name}</span>
              {l.paidReference && <span className="ml-2 text-[11px] text-zinc-400">ref {l.paidReference}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{formatUsd(l.amountCents)}</span>
              <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
              {canManage && l.status !== 'paid' && (
                <form action={markPaymentPaid} className="flex items-center gap-1">
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="scheduleId" value={l.id} />
                  <input name="reference" placeholder="ref" className={`${inputClass} w-20`} />
                  <Button type="submit" variant="secondary">Mark paid</Button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
