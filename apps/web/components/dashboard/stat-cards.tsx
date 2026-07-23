import { Clock, ShieldAlert, AlertTriangle, type IconComponent } from '@/components/icons';
import type { DashboardCounts } from '@/lib/data/dashboard';

interface CardConfig {
  key: keyof DashboardCounts;
  label: string;
  icon: IconComponent;
  subtitle: (n: number) => string;
  // Full literal class strings so Tailwind detects them.
  container: string;
  iconWrap: string;
  iconColor: string;
  value: string;
  labelColor: string;
  subColor: string;
}

const CARDS: CardConfig[] = [
  {
    key: 'pendingSignoff',
    label: 'Pending Sign-offs',
    icon: Clock,
    subtitle: (n) => `${n} task${n === 1 ? '' : 's'} awaiting review`,
    container:
      'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20',
    iconWrap: 'bg-blue-100 dark:bg-blue-900/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    value: 'text-blue-700 dark:text-blue-300',
    labelColor: 'text-blue-600 dark:text-blue-400',
    subColor: 'text-blue-500/70 dark:text-blue-500/50',
  },
  {
    key: 'blockers',
    label: 'Active Blockers',
    icon: ShieldAlert,
    subtitle: (n) => `${n} task${n === 1 ? '' : 's'} blocked and paused`,
    container:
      'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20',
    iconWrap: 'bg-orange-100 dark:bg-orange-900/40',
    iconColor: 'text-orange-600 dark:text-orange-400',
    value: 'text-orange-700 dark:text-orange-300',
    labelColor: 'text-orange-600 dark:text-orange-400',
    subColor: 'text-orange-500/70 dark:text-orange-500/50',
  },
  {
    key: 'breaches',
    label: 'SLA Breaches',
    icon: AlertTriangle,
    subtitle: (n) => `${n} task${n === 1 ? '' : 's'} past due date`,
    container: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20',
    iconWrap: 'bg-red-100 dark:bg-red-900/40',
    iconColor: 'text-red-600 dark:text-red-400',
    value: 'text-red-700 dark:text-red-300',
    labelColor: 'text-red-600 dark:text-red-400',
    subColor: 'text-red-500/70 dark:text-red-500/50',
  },
];

export function StatCards({ counts }: { counts: DashboardCounts }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {CARDS.map((card) => {
        const n = counts[card.key];
        return (
          <div key={card.key} className={`rounded-lg border p-4 ${card.container}`}>
            <div className="mb-2">
              <span className={`inline-flex rounded-lg p-2 ${card.iconWrap}`}>
                <card.icon size={20} className={card.iconColor} />
              </span>
            </div>
            <p className={`text-2xl font-bold ${card.value}`}>{n}</p>
            <p className={`text-xs ${card.labelColor}`}>{card.label}</p>
            <p className={`mt-0.5 text-[11px] ${card.subColor}`}>{card.subtitle(n)}</p>
          </div>
        );
      })}
    </div>
  );
}
