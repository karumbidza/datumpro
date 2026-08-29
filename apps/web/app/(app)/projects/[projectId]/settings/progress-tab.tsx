import Link from 'next/link';
import { Check } from '@/components/icons';
import { SETUP_ITEMS, type ProjectSetup } from '@/lib/data/project-setup';

/** The setup checklist — read-only progress that links into the edit tabs. */
export function ProgressTab({ projectId, setup }: { projectId: string; setup: ProjectSetup }) {
  const outstanding = setup.total - setup.done;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {setup.pct >= 100 ? 'All set — every item is done 🎉' : `${setup.pct}% complete · ${outstanding} item${outstanding === 1 ? '' : 's'} outstanding`}
        </p>
        <span className="text-sm font-semibold tabular-nums">{setup.pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${setup.pct}%` }} />
      </div>

      <ul className="mt-5 space-y-2">
        {SETUP_ITEMS.map((item) => {
          const complete = Boolean(setup.status[item.key]);
          const href = item.href?.(projectId) ?? null;
          const row = (
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  complete
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-zinc-300 text-transparent dark:border-zinc-600'
                }`}
              >
                <Check size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${complete ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>
                  {item.label}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.hint}</p>
              </div>
              {!complete &&
                (href ? (
                  <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Set up →</span>
                ) : (
                  <span className="text-xs text-zinc-300 dark:text-zinc-600">Coming soon</span>
                ))}
            </div>
          );
          return (
            <li key={item.key}>
              {href && !complete ? (
                <Link href={href} className="block transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
