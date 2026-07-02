/** Text/label helpers for the field app. Colour tones live in lib/theme.ts. */

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  submitted: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};
export function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

const SLA_LABEL: Record<string, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  pending_signoff: 'Pending sign-off',
  blocked: 'Blocked',
  breached: 'Overdue',
  resolved_on_time: 'On time',
  resolved_late: 'Resolved late',
};
export function slaLabel(s: string): string {
  return SLA_LABEL[s] ?? s;
}
