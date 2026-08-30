import { StatCards } from '@/components/dashboard/stat-cards';
import type { PortfolioKpis } from '@/lib/data/portfolio';

/** Neutral portfolio KPIs — the "how big is the company" glance, distinct from the
 *  colour-coded action cards below it. */
export function KpiRow({ kpis }: { kpis: PortfolioKpis }) {
  return (
    <StatCards
      cells={[
        { label: 'Total projects', value: String(kpis.total) },
        { label: 'In progress', value: String(kpis.active) },
        { label: 'On hold', value: String(kpis.onHold) },
        { label: 'Complete', value: String(kpis.completed) },
        { label: 'Overall progress', value: `${kpis.overallProgressPct}%` },
      ]}
    />
  );
}
