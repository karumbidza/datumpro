import type { ReactNode } from 'react';

type Width = 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl';

const MAX: Record<Width, string> = {
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

/** One place for page gutters + width so every screen's spacing is identical.
 *  Renders a <div> (the app shell already provides the single <main>). */
export function PageContainer({
  width = '3xl',
  className = '',
  children,
}: {
  width?: Width;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`mx-auto ${MAX[width]} px-4 py-6 sm:px-6 ${className}`}>{children}</div>;
}
