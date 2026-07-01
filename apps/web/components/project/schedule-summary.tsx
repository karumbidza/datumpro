import { scheduleHealth, type ScheduleHealth } from '@datumpro/shared/domain';
import { Card, CardTitle } from '@/components/ui/card';
import type { ProjectSchedule } from '@/lib/data/scheduling';

const HEALTH: Record<ScheduleHealth, { label: string; cls: string }> = {
  ahead: { label: 'Ahead of schedule', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
  on_track: { label: 'On track', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
  slightly_behind: { label: 'Slightly behind', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  behind: { label: 'Behind schedule', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
};

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="font-medium tabular-nums">{clamped.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
      </div>
    </div>
  );
}

export function ScheduleSummary({ data }: { data: ProjectSchedule }) {
  const health = HEALTH[scheduleHealth(data.progress.spi)];
  const criticalCount = data.schedule.criticalPath.length;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Schedule &amp; earned progress</CardTitle>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${health.cls}`}>{health.label}</span>
      </div>

      <div className="mt-4 space-y-3">
        <Bar label="Earned (verified)" pct={data.progress.earnedPct} color="#2563eb" />
        <Bar label="Planned by now" pct={data.progress.plannedPct} color="#a1a1aa" />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-4">
        <Metric label="SPI" value={data.progress.spi.toFixed(2)} hint="earned ÷ planned" />
        <Metric label="On critical path" value={`${criticalCount} task${criticalCount === 1 ? '' : 's'}`} />
        <Metric label="Projected finish" value={data.projectedFinish ?? '—'} />
        <Metric label="Baseline finish" value={data.baselineFinish ?? '—'} />
      </dl>

      {data.schedule.hasCycle && (
        <p className="mt-3 text-xs text-red-500">
          A circular dependency was detected — fix it to restore the schedule forecast.
        </p>
      )}
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
      {hint && <dd className="text-[10px] text-zinc-400">{hint}</dd>}
    </div>
  );
}
