import type { ProgressPoint } from '@/lib/data/subtasks';

/** Compact burn-up sparkline for the project overview. Plots the last N daily
 *  snapshots (0–100 on the y-axis) as a filled area + line, with the net change
 *  over the window. Renders nothing until there are at least two points, since a
 *  single dot isn't a trend and the live bar already shows the current number. */
export function ProgressTrend({ points, className = '' }: { points: ProgressPoint[]; className?: string }) {
  if (points.length < 2) return null;

  const W = 240;
  const H = 44;
  const pad = 3;
  const n = points.length;

  const x = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  // Fixed 0–100 domain so the slope reads as real progress, not autoscaled noise.
  const y = (pct: number) => pad + (1 - Math.max(0, Math.min(100, pct)) / 100) * (H - 2 * pad);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;

  const first = points[0]!.pct;
  const last = points[n - 1]!.pct;
  const delta = last - first;
  const fmt = (d: string) => d.slice(5); // MM-DD

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Progress trend</span>
        <span
          className={`text-[11px] font-medium tabular-nums ${
            delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
          }`}
        >
          {delta > 0 ? `+${delta}` : delta} pts
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-11 w-full" preserveAspectRatio="none" aria-hidden>
        <path d={area} className="fill-brand-500/10" />
        <path d={line} className="stroke-brand-600" strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(n - 1)} cy={y(last)} r={2.5} className="fill-brand-600" />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-400">
        <span>{fmt(points[0]!.day)}</span>
        <span>{fmt(points[n - 1]!.day)}</span>
      </div>
    </div>
  );
}
