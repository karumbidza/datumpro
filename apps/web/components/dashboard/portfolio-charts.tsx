import { Card, CardTitle } from '@/components/ui/card';
import type { ProjectStatus } from '@datumpro/shared/domain';
import type { PortfolioData } from '@/lib/data/portfolio';

const STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: '#3b82f6',
  active: '#16a34a',
  on_hold: '#d97706',
  completed: '#2563eb',
  archived: '#a1a1aa',
};

/** Project-by-status distribution as inline-SVG vertical bars (zero-dependency,
 *  matching the timeline's aesthetic). */
export function StatusChart({ data }: { data: PortfolioData['statusDistribution'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card>
      <CardTitle>Projects by status</CardTitle>
      {data.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">No projects yet.</p>
      ) : (
        <div className="mt-4 flex items-end gap-4" style={{ height: 140 }}>
          {data.map((d) => (
            <div key={d.status} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-medium tabular-nums text-zinc-500">{d.count}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(d.count / max) * 100}%`,
                  minHeight: 4,
                  background: STATUS_COLOR[d.status],
                }}
              />
              <span className="text-[10px] capitalize text-zinc-400">{d.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Company progress-over-time as an inline-SVG area/line. */
export function ProgressTrend({ series }: { series: PortfolioData['progressSeries'] }) {
  const W = 300;
  const H = 100;
  return (
    <Card>
      <CardTitle>Reported progress over time</CardTitle>
      {series.length < 2 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          Not enough site reports yet to chart a trend.
        </p>
      ) : (
        (() => {
          const pts = series.map((p, i) => {
            const x = (i / (series.length - 1)) * W;
            const y = H - (Math.max(0, Math.min(100, p.pct)) / 100) * H;
            return { x, y };
          });
          const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          const area = `0,${H} ${line} ${W},${H}`;
          const last = series[series.length - 1]!;
          return (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{last.pct}%</span>
                <span className="text-xs text-zinc-400">latest average</span>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-28 w-full">
                <polygon points={area} fill="#2563eb" opacity="0.08" />
                <polyline
                  points={line}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>{series[0]!.date}</span>
                <span>{last.date}</span>
              </div>
            </>
          );
        })()
      )}
    </Card>
  );
}
