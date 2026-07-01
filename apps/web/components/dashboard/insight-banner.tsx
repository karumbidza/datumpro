import { AlertTriangle, ShieldAlert, Clock, FileText, type IconComponent } from '@/components/icons';
import type { DashboardCounts } from '@/lib/data/dashboard';

interface Insight {
  icon: IconComponent;
  text: string;
  cls: string;
}

/** Surfaces the single most-important live signal (not a hardcoded string):
 *  breaches → blockers → pending sign-offs → open requests → all clear. */
function pickInsight(counts: DashboardCounts): Insight {
  if (counts.breaches > 0)
    return {
      icon: AlertTriangle,
      text: `${counts.breaches} task${counts.breaches === 1 ? '' : 's'} past their due date need attention.`,
      cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400',
    };
  if (counts.blockers > 0)
    return {
      icon: ShieldAlert,
      text: `${counts.blockers} task${counts.blockers === 1 ? '' : 's'} blocked and paused — resolve to keep the schedule moving.`,
      cls: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/20 dark:text-orange-400',
    };
  if (counts.pendingSignoff > 0)
    return {
      icon: Clock,
      text: `${counts.pendingSignoff} task${counts.pendingSignoff === 1 ? '' : 's'} awaiting your sign-off.`,
      cls: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-400',
    };
  if (counts.openRequests > 0)
    return {
      icon: FileText,
      text: `${counts.openRequests} request${counts.openRequests === 1 ? '' : 's'} awaiting approval.`,
      cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400',
    };
  return {
    icon: Clock,
    text: 'Nothing needs your attention right now — all tasks are on track.',
    cls: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-400',
  };
}

export function InsightBanner({ counts }: { counts: DashboardCounts }) {
  const insight = pickInsight(counts);
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${insight.cls}`}>
      <insight.icon size={18} />
      <p className="text-sm font-medium">{insight.text}</p>
    </div>
  );
}
