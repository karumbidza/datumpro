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
      <div className="grid grid-cols-2 divide-zinc-100 dark:divide-zinc-800 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {cells.map((c) => (
          <div key={c.label} className="px-5 py-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
