import type { ReactNode } from 'react';

const TONES = {
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  faint: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  blue: 'bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-500',
  green: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  // Roles (owner/admin) and "variation" categories that sit outside the
  // priority/status colour language.
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
