import type { ReactNode } from 'react';

/** Simple surface card — one consistent container for content blocks. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{children}</h3>;
}

export function CardValue({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-2xl font-semibold tracking-tight">{children}</p>;
}
