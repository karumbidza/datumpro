import type { ReactNode } from 'react';

type Width = 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';

const MAX: Record<Width, string> = {
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
};

/** THE page gutter — the only padding system in the app. Every screen gets the
 *  identical responsive gutters (px-4 → sm:px-6 → lg:px-8, py-6 → lg:py-8);
 *  page sections stack 32px apart (space-y-8 / gap-8). Never hand-roll a page
 *  container. Renders a <div> (the app shell already provides the single <main>). */
export function PageContainer({
  width = '3xl',
  className = '',
  children,
}: {
  width?: Width;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${MAX[width]} px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${className}`}>
      {children}
    </div>
  );
}
