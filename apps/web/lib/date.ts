/**
 * Minimal date helpers — the handful of functions the timeline/Gantt port needs,
 * implemented locally so we don't pull in a date library. All operate on local
 * time and treat invalid input defensively (returning null where appropriate).
 */

const MS_PER_DAY = 86_400_000;

/** Parse an ISO string or Date into a Date, or null if unparseable. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Midnight (local) of the given date. */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole-day difference a − b (positive when a is later). */
export function differenceInDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY);
}

/** "Mon 3" style label. */
export function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Monday, 3 June 2026" style label for the dashboard header. */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** ISO week number (1–53). */
export function weekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - start.getTime()) / MS_PER_DAY + start.getDay() + 1) / 7);
}
