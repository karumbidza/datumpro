import type { ReactNode } from 'react';
import type { IconComponent } from '@/components/icons';

/** The one empty-state treatment (ported from the original app): quiet icon,
 *  short title, optional hint and action. Use wherever a list can be empty. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className = '',
}: {
  icon?: IconComponent;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 py-10 text-center ${className}`}>
      {Icon && <Icon size={28} className="mb-1 text-zinc-300 dark:text-zinc-600" />}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {hint && <p className="mx-auto max-w-sm text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
