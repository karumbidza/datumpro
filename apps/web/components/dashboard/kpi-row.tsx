import { Card } from '@/components/ui/card';
import type { PortfolioKpis } from '@/lib/data/portfolio';

/** Neutral portfolio KPIs — the "how big is the company" glance, distinct from the
 *  colour-coded action cards below it. */
export function KpiRow({ kpis }: { kpis: PortfolioKpis }) {
  const cells = [
    { label: 'Total projects', value: String(kpis.total) },
    { label: 'In progress', value: String(kpis.active) },
    { label: 'On hold', value: String(kpis.onHold) },
    { label: 'Complete', value: String(kpis.completed) },
    { label: 'Overall progress', value: `${kpis.overallProgressPct}%` },
  ];
  return (
    <Card className="p-0">
      <div className="grid grid-cols-5">
        {cells.map((c) => (
          <div
            key={c.label}
            className="px-5 py-4 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-zinc-100 dark:[&:not(:last-child)]:border-zinc-800"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
