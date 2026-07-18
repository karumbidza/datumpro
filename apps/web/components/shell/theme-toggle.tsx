'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from '@/components/icons';

/** Light/dark toggle. Flips the resolved theme; the choice persists via
 *  next-themes. Renders a stable placeholder until mounted to avoid a
 *  hydration mismatch (the server can't know the resolved theme). */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={mounted ? (isDark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
      aria-label="Toggle theme"
      className="flex items-center rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      {mounted && isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
