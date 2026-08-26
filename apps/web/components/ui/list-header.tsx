import type { CSSProperties, ReactNode } from 'react';

/**
 * THE columnar list header — the sticky uppercase label row above grid-based
 * lists (tasks board, and any list that shares a `gridTemplateColumns`). Pass the
 * same `style` the rows use so columns line up. Sticky by default so it stays put
 * while the list scrolls inside the app's scrolling `<main>`.
 */
export function ListHeader({
  style,
  sticky = true,
  className = '',
  children,
}: {
  style?: CSSProperties;
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid items-center border-b border-zinc-200 px-4 pb-2 pt-2 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 ${
        sticky ? 'sticky top-0 z-10 bg-white/90 backdrop-blur dark:bg-zinc-950/90' : ''
      } ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
