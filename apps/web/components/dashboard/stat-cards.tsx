import { Card } from '@/components/ui/card';

export type StatCell = {
  label: string;
  value: string;
  /** Colours the value (e.g. amber = needs attention, green = done). */
  tone?: 'amber' | 'green';
};

const TONE: Record<NonNullable<StatCell['tone']>, string> = {
  amber: 'text-amber-600 dark:text-amber-400',
  green: 'text-green-600 dark:text-green-400',
};

/** The dashboard "glance" row: a bordered card of evenly-divided stat cells.
 *  Shared by the portfolio KPIs and the personal work stats so every dashboard —
 *  owner, PM, contractor, viewer — reads the same. */
export function StatCards({ cells }: { cells: StatCell[] }) {
  return (
    <Card className="p-0">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      >
        {cells.map((c) => (
          <div
            key={c.label}
            className="px-5 py-4 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-zinc-100 dark:[&:not(:last-child)]:border-zinc-800"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${
                c.tone ? TONE[c.tone] : 'text-zinc-900 dark:text-white'
              }`}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
