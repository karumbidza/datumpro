/** Pure helpers for the cross-org notification toast stack. No React, no Supabase,
 *  no app types — so it lives here where vitest runs (apps/web has no test runner). */

export interface ToastModel {
  id: string;
  orgId: string;
  orgName: string | null;
  title: string;
  body: string | null;
  link: string | null;
  type: string;
}

/** The `notifications` row fields a toast needs, snake_case as Postgres/realtime
 *  deliver them (the realtime payload's `new` object and a raw select row). */
export interface NotificationRow {
  id: string;
  org_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Max toasts shown at once; the rest queue behind them. */
export const MAX_VISIBLE_TOASTS = 3;

/** Map a row to a toast model, resolving the org name from the viewer's
 *  memberships. Unknown org (e.g. one the user has since left) → null so the card
 *  renders without an "{Org} ·" prefix instead of crashing. */
export function notificationRowToToast(
  row: NotificationRow,
  orgsById: Record<string, { name: string }>,
): ToastModel {
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: orgsById[row.org_id]?.name ?? null,
    title: row.title,
    body: row.body,
    link: row.link,
    type: row.type,
  };
}

/** Prepend a toast (newest-first), skipping duplicates by id. Returns the same
 *  array reference when the id is already present so callers can no-op. */
export function enqueueToast(stack: ToastModel[], next: ToastModel): ToastModel[] {
  if (stack.some((t) => t.id === next.id)) return stack;
  return [next, ...stack];
}

export type ToastAccent = 'amber' | 'green' | 'blue' | 'neutral';

/** Left-bar accent colour keyed off the notification type prefix. */
export function toastAccent(type: string): ToastAccent {
  if (type.startsWith('approval')) return 'amber';
  if (type.startsWith('payment') || type.startsWith('retention')) return 'green';
  if (type.startsWith('tender')) return 'blue';
  return 'neutral';
}
