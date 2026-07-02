/** Shared presentation helpers for the field app. */

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

export interface Tone {
  bg: string;
  fg: string;
}
/** Colour tone for an SLA status chip. */
export function slaTone(s: string): Tone {
  switch (s) {
    case 'breached':
      return { bg: '#fee2e2', fg: '#b91c1c' };
    case 'at_risk':
      return { bg: '#fef3c7', fg: '#b45309' };
    case 'blocked':
      return { bg: '#e5e7eb', fg: '#374151' };
    case 'resolved_on_time':
    case 'on_track':
      return { bg: '#dcfce7', fg: '#15803d' };
    default:
      return { bg: '#eef2ff', fg: '#4338ca' };
  }
}
