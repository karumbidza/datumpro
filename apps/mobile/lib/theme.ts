/** DatumPro Field — design tokens. Change `accent` in one place to re-skin. */
export const theme = {
  color: {
    bg: '#f3f4f6',
    card: '#ffffff',
    text: '#18181b',
    muted: '#6b7280',
    subtle: '#9ca3af',
    border: '#eceef1',
    accent: '#f2662d', // brand accent — single swap point
    accentSoft: '#fdeee6',
    dark: '#0e0e10', // black pills / active tab, as in the reference
    onDark: '#ffffff',
    success: '#16a34a',
    successSoft: '#dcfce7',
    warning: '#d97706',
    warningSoft: '#fef3c7',
    danger: '#dc2626',
    dangerSoft: '#fee2e2',
  },
  radius: { sm: 12, md: 18, lg: 24, pill: 999 },
  // Cap content width so phones fill the screen but tablets / landscape stay
  // readable (centered column). Applied to scroll/list content containers.
  maxWidth: 640,
} as const;

/** Centered, width-capped content container — spread into contentContainerStyle. */
export const contentWidth = { width: '100%', maxWidth: theme.maxWidth, alignSelf: 'center' } as const;

export type Tone = { bg: string; fg: string; bar: string };

/** Colour tone for a task's SLA / lateness state. */
export function slaTone(sla: string): Tone {
  const c = theme.color;
  switch (sla) {
    case 'breached':
      return { bg: c.dangerSoft, fg: c.danger, bar: c.danger };
    case 'at_risk':
      return { bg: c.warningSoft, fg: c.warning, bar: c.warning };
    case 'resolved_on_time':
    case 'on_track':
      return { bg: c.successSoft, fg: c.success, bar: c.success };
    case 'blocked':
      return { bg: '#e5e7eb', fg: '#374151', bar: '#6b7280' };
    default:
      return { bg: c.accentSoft, fg: c.accent, bar: c.accent };
  }
}

/** Rough completion % from task status, for the per-task progress bar (our tasks
 *  don't store a % — this is a visual stand-in derived from workflow state). */
export function statusProgress(status: string): number {
  switch (status) {
    case 'done':
      return 100;
    case 'submitted':
      return 90;
    case 'in_progress':
      return 55;
    case 'blocked':
      return 30;
    default:
      return 8;
  }
}
