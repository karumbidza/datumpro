/** A project's working calendar: which weekdays are worked (0=Sun..6=Sat) and the
 *  ISO holiday dates to skip. Mirrors the SQL add_working_days semantics. */
export interface WorkCalendar {
  /** Working days of week, JS getUTCDay numbering (0=Sun … 6=Sat). */
  workingDows: number[];
  /** ISO (YYYY-MM-DD) holiday dates to skip. */
  holidays: string[];
}

function isWorking(iso: string, cal: WorkCalendar): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return cal.workingDows.includes(dow) && !cal.holidays.includes(iso);
}
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The date `n` working days after `start`, skipping non-working days & holidays.
 *  `n<=0` returns `start` rolled forward to the next working day (matches SQL). */
export function addWorkingDays(start: string, n: number, cal: WorkCalendar): string {
  let d = start;
  while (!isWorking(d, cal)) d = shift(d, 1);
  if (n <= 0) return d;
  let added = 0;
  while (added < n) {
    d = shift(d, 1);
    if (isWorking(d, cal)) added += 1;
  }
  return d;
}

/** Inclusive count of working days from `start` to `end` (both ISO). Min 0. */
export function workingDaysBetween(start: string, end: string, cal: WorkCalendar): number {
  if (end < start) return 0;
  let d = start;
  let count = 0;
  while (d <= end) {
    if (isWorking(d, cal)) count += 1;
    d = shift(d, 1);
  }
  return count;
}
