import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * THE page header. One structure for every screen: optional back-link, the
 * `text-2xl` title, an optional muted subtitle at a fixed `mt-0.5`, an optional
 * right-aligned actions slot, and a `children` slot for extra header content
 * (progress bars, legends). Never hand-roll a title/back-link block.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
            ← {backLabel}
          </Link>
        )}
        <h1 className={`${backHref ? 'mt-1 ' : ''}text-2xl font-semibold tracking-tight`}>{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
