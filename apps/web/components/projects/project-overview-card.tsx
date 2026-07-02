import Link from 'next/link';
import type { ProjectOverview, OverviewMilestone } from '@/lib/data/projects-overview';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from '@/components/icons';
import { formatUsd } from '@datumpro/shared/domain';

const STATUS_TONE = {
  active: 'green',
  planning: 'blue',
  on_hold: 'amber',
  completed: 'neutral',
  archived: 'neutral',
} as const;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const DOT: Record<OverviewMilestone['status'], string> = {
  done: 'bg-green-500',
  in_progress: 'bg-amber-500',
  pending: 'bg-zinc-300 dark:bg-zinc-600',
  missed: 'bg-red-500',
};

/** Full-width project row — name, a progress bar spanning the width with milestone
 *  markers, completion %, status, and a hover popover with the timeline. */
export function ProjectOverviewCard({ project: p }: { project: ProjectOverview }) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="group relative flex items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
    >
      {/* Name / client */}
      <div className="w-40 shrink-0">
        <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{p.name}</h2>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{p.clientName ?? '—'}</p>
      </div>

      {/* Progress bar with milestone markers */}
      <div className="min-w-0 flex-1">
        <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="absolute left-0 top-0 h-2 rounded-full bg-brand-500"
            style={{ width: `${p.completionPct}%` }}
          />
          {p.milestones.map((m) => (
            <span
              key={m.id}
              title={`${m.name}${m.targetDate ? ` · ${fmt(m.targetDate)}` : ''} · ${m.status.replace('_', ' ')}`}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-zinc-950 ${DOT[m.status]}`}
              style={{ left: `${m.position}%` }}
            />
          ))}
        </div>
        <div className="mt-1 hidden items-center justify-between text-[10px] text-zinc-400 sm:flex">
          <span>{fmt(p.startDate)}</span>
          {p.nextMilestone && (
            <span className="truncate px-2">
              Next: <span className="text-zinc-500 dark:text-zinc-400">{p.nextMilestone.name}</span>
              {p.nextMilestone.targetDate ? ` · ${fmt(p.nextMilestone.targetDate)}` : ''}
            </span>
          )}
          <span>{fmt(p.endDate)}</span>
        </div>
      </div>

      {/* Completion % */}
      <div className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">
        {p.completionPct}%
      </div>

      {/* Status + contract (contract hidden on small) */}
      <div className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-zinc-400 md:block">
        {formatUsd(p.contractValueCents)}
      </div>
      <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
      <ChevronRight size={16} className="hidden shrink-0 text-zinc-300 group-hover:text-zinc-500 sm:block" />

      {/* Hover popover — timeline + milestones */}
      <div className="pointer-events-none absolute right-4 top-full z-10 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-3 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Timeline</p>
        <Row label="Start" value={fmt(p.startDate)} />
        <Row label="Target end" value={fmt(p.endDate)} />
        <Row label="Tasks done" value={`${p.doneTasks}/${p.totalTasks}`} />
        {p.milestones.length > 0 && (
          <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Milestones</p>
            <ul className="space-y-1">
              {p.milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[m.status]}`} />
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-zinc-400">{fmt(m.targetDate)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{value}</span>
    </div>
  );
}
