import { Card, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@datumpro/shared/domain';
import type { ReceivablesAging } from '@/lib/data/finance-portfolio';

// Not-due → overdue, cool → hot. Semantic, not the brand accent.
const BUCKET_COLOR: Record<string, string> = {
  current: 'bg-zinc-300 dark:bg-zinc-600',
  '1_30': 'bg-amber-300',
  '31_60': 'bg-amber-400',
  '61_90': 'bg-orange-500',
  '90_plus': 'bg-red-500',
};

/** Aged receivables — outstanding client balances bucketed by how overdue they
 *  are. The overdue total is the number that should worry a finance lead. */
export function ReceivablesAging({ aging }: { aging: ReceivablesAging }) {
  const { totalOutstandingCents, overdueCents, buckets } = aging;
  if (totalOutstandingCents <= 0) return null;

  const active = buckets.filter((b) => b.cents > 0);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Aged receivables</CardTitle>
        <span className="text-xs text-zinc-500">
          {formatUsd(overdueCents)} overdue of {formatUsd(totalOutstandingCents)} outstanding
        </span>
      </div>

      {/* Stacked share bar */}
      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {active.map((b) => (
          <div
            key={b.key}
            className={`h-full ${BUCKET_COLOR[b.key] ?? 'bg-zinc-300'}`}
            style={{ width: `${(b.cents / totalOutstandingCents) * 100}%` }}
            title={`${b.label}: ${formatUsd(b.cents)}`}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.key}>
            <div className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${BUCKET_COLOR[b.key] ?? 'bg-zinc-300'}`} />
              <span className={`text-[11px] ${b.overdue ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}`}>
                {b.label}
              </span>
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatUsd(b.cents)}</p>
            <p className="text-[11px] text-zinc-400">
              {b.count} invoice{b.count === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
