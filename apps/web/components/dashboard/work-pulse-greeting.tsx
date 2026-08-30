'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { composeWorkPulse, type WorkPulseData } from '@datumpro/shared/domain';

const PLAYFUL_KEY = 'dp_workpulse_playful_at';
const PLAYFUL_COOLDOWN_MS = 3 * 86_400_000; // don't do the late-night line more than once every 3 days

/** Was the playful late-night line shown recently? Per-viewer, best-effort. */
function playfulAllowed(): boolean {
  try {
    const raw = localStorage.getItem(PLAYFUL_KEY);
    if (!raw) return true;
    return Date.now() - Number(raw) > PLAYFUL_COOLDOWN_MS;
  } catch {
    return true;
  }
}
function markPlayfulShown(): void {
  try {
    localStorage.setItem(PLAYFUL_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** The dashboard's dynamic greeting. Time of day (and the date) are computed from
 *  the viewer's own clock — the server has no per-user timezone — so this renders a
 *  neutral first line on the server and fills in the time-aware greeting on mount.
 *  The contextual insight and glance are data-driven and render identically both
 *  sides. */
export function WorkPulseGreeting({
  data,
  context,
  action,
}: {
  data: WorkPulseData;
  context: string; // e.g. the org name, "Delivery overview", "Your work"
  action?: ReactNode;
}) {
  const [state, setState] = useState<{ now: Date; allowPlayful: boolean } | null>(null);

  useEffect(() => {
    const d = new Date();
    const allow = playfulAllowed();
    const late = d.getHours() >= 22 || d.getHours() < 5;
    // Mark it shown when it will actually appear, but keep `allow` for THIS render
    // so the line we're recording still shows now (and is suppressed next time).
    if (allow && late && data.userRecentlyActive) markPlayfulShown();
    setState({ now: d, allowPlayful: allow });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mounted = state !== null;
  const now = state?.now ?? null;
  const greeting = composeWorkPulse(data, now ?? new Date(), { allowPlayful: state?.allowPlayful ?? false });

  return (
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-2xl">
          {mounted ? greeting.primary : `Hi, ${data.firstName}`}
          {mounted && greeting.emoji ? ` ${greeting.emoji}` : ''}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{greeting.insight}</p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {context}
          {now ? ` · ${longDate(now)}` : ''}
        </p>
      </div>
      {action}
    </div>
  );
}
