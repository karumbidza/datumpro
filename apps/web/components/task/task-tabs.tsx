'use client';

import { useState, type ReactNode } from 'react';

export interface TaskTab {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/** Client-side tab strip for the task detail page. Panels are rendered on the
 *  server and passed in as `content`; this only toggles which one is visible. */
export function TaskTabs({ tabs }: { tabs: TaskTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!current) return null;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const isActive = t.key === current.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' && t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                    isActive
                      ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Panels root at `<Card className="mt-6">`; zero that inside the tab. */}
      <div className="pt-5 [&>*:first-child]:mt-0">{current.content}</div>
    </div>
  );
}
