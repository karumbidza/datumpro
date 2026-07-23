import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatUsd, PAYMENT_REQUEST_STATUS_LABEL, type PaymentRequestStatus } from '@datumpro/shared/domain';
import { RequestPaymentForm, type RequestTask } from '@/components/payments/request-payment-form';
import type { TaskPaymentInfo } from '@/lib/data/owed';

const TONE: Record<PaymentRequestStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  requested: 'amber',
  approved: 'blue',
  paid: 'green',
  rejected: 'neutral',
};

/** The task's own payment position + request flow — so the assignee (contractor,
 *  PM or admin alike) sees their balance for this task and invoices against it
 *  right here. Managers see it read-only. */
export function TaskPaymentPanel({
  info,
  task,
  isAssignee,
}: {
  info: TaskPaymentInfo;
  task: { taskId: string; title: string; projectId: string; orgId: string };
  isAssignee: boolean;
}) {
  const requestTask: RequestTask = {
    taskId: task.taskId,
    title: task.title,
    projectId: task.projectId,
    orgId: task.orgId,
    projectName: '',
    requestableCents: info.requestableCents,
  };

  return (
    <Card className="space-y-4">
      <CardTitle>Payment</CardTitle>

      {/* Balance for this task */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Committed" value={formatUsd(info.committedCents)} />
        <Stat label="Paid" value={formatUsd(info.paidCents)} tone="green" />
        {info.pendingCents > 0 && <Stat label="In review" value={formatUsd(info.pendingCents)} tone="amber" />}
        <Stat label="Outstanding" value={formatUsd(info.outstandingCents)} />
      </div>

      {isAssignee ? (
        info.requestableCents > 0 ? (
          <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-[13px] text-zinc-500 dark:text-zinc-400">
              {formatUsd(info.requestableCents)} still claimable on this task.
            </p>
            <RequestPaymentForm tasks={[requestTask]} taskId={task.taskId} />
          </div>
        ) : (
          <p className="border-t border-zinc-100 pt-4 text-[13px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {info.committedCents > 0 && info.paidCents >= info.committedCents
              ? 'Fully paid — nothing left to claim on this task.'
              : 'Nothing more to claim right now — a request is in review.'}
          </p>
        )
      ) : null}

      {/* Request history for this task */}
      {info.requests.length > 0 && (
        <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Requests</p>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {info.requests.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    {r.invoiceUrl && (
                      <a
                        href={r.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                      >
                        view invoice
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">{formatUsd(r.amountCents)}</span>
                    <Badge tone={TONE[r.status]}>{PAYMENT_REQUEST_STATUS_LABEL[r.status]}</Badge>
                  </div>
                </div>
                {r.status === 'rejected' && r.reviewNote && (
                  <p className="mt-1 text-xs text-zinc-500">Rejected — “{r.reviewNote}”</p>
                )}
                {r.status === 'paid' && r.paidReference && (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">Paid · ref {r.paidReference}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  const color =
    tone === 'green'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-zinc-900 dark:text-white';
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
