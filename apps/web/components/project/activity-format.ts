/* Shared visual + time language for the project activity feed (preview + full view). */

/** Dot colour per activity type — the audit trail's own colour language. */
const ACTIVITY_DOT: Record<string, string> = {
  created: 'bg-zinc-400 dark:bg-zinc-500',
  assigned: 'bg-brand-500',
  status: 'bg-amber-500',
  blocker: 'bg-red-500',
  done: 'bg-green-500',
};

/** Type chips shown in the full view, in display order. */
export const ACTIVITY_TYPES = ['created', 'assigned', 'status', 'blocker', 'done'] as const;

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  assigned: 'Assigned',
  status: 'Status',
  blocker: 'Blocked',
  done: 'Done',
};

export function dotClass(type: string): string {
  return ACTIVITY_DOT[type] ?? 'bg-zinc-400 dark:bg-zinc-500';
}

export function typeLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.replace(/_/g, ' ');
}

/** Compact relative time, e.g. "just now", "5m", "3h", "2d", or a date past a week. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Day bucket label: 'Today' | 'Yesterday' | 'Mon, Aug 24'. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86_400_000;
  const diff = Math.round((startOf(new Date()) - startOf(d)) / dayMs);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Group already-sorted (newest-first) items into day buckets, order preserved. */
export function groupByDay<T extends { createdAt: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
