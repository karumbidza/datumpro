import { Card, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@datumpro/shared/domain';

/** Budget vs contractor cost. Shows planned budget against what's been
 *  committed to contractors (all draws) and paid out so far (cost to date),
 *  with a stacked bar and an under/over-budget read-out. Cost is money *out* —
 *  distinct from the client-billing KPIs above it. */
export function BudgetVsCost({
  budgetCents,
  committedCostCents,
  costToDateCents,
}: {
  budgetCents: number;
  committedCostCents: number;
  costToDateCents: number;
}) {
  const remainingCents = budgetCents - committedCostCents;
  const over = remainingCents < 0;

  // Segments as % of budget: paid (green) then committed-but-unpaid (amber),
  // clamped so they never exceed the track even when over budget.
  const paidPct = budgetCents > 0 ? Math.min(100, (costToDateCents / budgetCents) * 100) : 0;
  const committedUnpaid = Math.max(0, committedCostCents - costToDateCents);
  const unpaidPct =
    budgetCents > 0 ? Math.min(100 - paidPct, (committedUnpaid / budgetCents) * 100) : 0;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Budget vs cost</CardTitle>
        <span className={`text-xs font-medium ${over ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'}`}>
          {over ? `Over by ${formatUsd(-remainingCents)}` : `${formatUsd(remainingCents)} left`}
        </span>
      </div>

      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full bg-green-500" style={{ width: `${paidPct}%` }} title="Paid to date" />
        <div className="h-full bg-amber-400" style={{ width: `${unpaidPct}%` }} title="Committed, unpaid" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-zinc-500">Budget</p>
          <p className="font-semibold tabular-nums">{formatUsd(budgetCents)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Committed</p>
          <p className="font-semibold tabular-nums">{formatUsd(committedCostCents)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Cost to date</p>
          <p className="font-semibold tabular-nums text-green-600 dark:text-green-400">
            {formatUsd(costToDateCents)}
          </p>
        </div>
      </div>
    </Card>
  );
}
