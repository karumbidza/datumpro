import { Clock, ShieldAlert, AlertTriangle, FileText, Check, type IconComponent } from '@/components/icons';
import type { DashboardCounts } from '@/lib/data/dashboard';

interface Signal {
  key: keyof DashboardCounts;
  n: number;
  icon: IconComponent;
  singular: string;
  plural: string;
  dot: string;
  chip: string;
}

/** All the live attention signals, worst first. This is the dashboard's single
 *  attention surface — every non-zero item shows as a chip, so nothing is lost the
 *  way it was when only the worst signal was displayed. */
export function InsightBanner({ counts }: { counts: DashboardCounts }) {
  const signals: Signal[] = [
    {
      key: 'breaches',
      n: counts.breaches,
      icon: AlertTriangle,
      singular: 'task past due',
      plural: 'tasks past due',
      dot: 'bg-red-500',
      chip: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400',
    },
    {
      key: 'blockers',
      n: counts.blockers,
      icon: ShieldAlert,
      singular: 'active blocker',
      plural: 'active blockers',
      dot: 'bg-orange-500',
      chip: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400',
    },
    {
      key: 'pendingSignoff',
      n: counts.pendingSignoff,
      icon: Clock,
      singular: 'task awaiting sign-off',
      plural: 'tasks awaiting sign-off',
      dot: 'bg-blue-500',
      chip: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400',
    },
    {
      key: 'openRequests',
      n: counts.openRequests,
      icon: FileText,
      singular: 'request awaiting approval',
      plural: 'requests awaiting approval',
      dot: 'bg-amber-500',
      chip: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400',
    },
  ];

  const active = signals.filter((s) => s.n > 0);

  if (active.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-400">
        <Check size={18} />
        <p className="text-sm font-medium">Nothing needs your attention right now — all tasks are on track.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Needs your attention</p>
      <div className="flex flex-wrap gap-2">
        {active.map((s) => (
          <span
            key={s.key}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.chip}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.n} {s.n === 1 ? s.singular : s.plural}
          </span>
        ))}
      </div>
    </div>
  );
}
