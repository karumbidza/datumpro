'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** Wraps next-themes with the app's settings: class-based (`.dark` on <html>),
 *  seeded from the OS on first visit, and the user's choice persisted to
 *  localStorage. The no-flash script is injected by next-themes. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
