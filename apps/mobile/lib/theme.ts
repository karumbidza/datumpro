/** DatumPro Field — design tokens (v2).
 *
 *  Colours come in a light/dark PAIR resolved at render through the theme
 *  context (see lib/theme-context). Never hardcode a hex for text or pill
 *  colours — resolve through `colors`. On-colour white (#fff) is only valid on a
 *  filled brand/accent/status surface. Status pills map to a {soft bg, deep fg}
 *  token pair so they stay legible in dark mode. */

export const lightColors = {
  bg: '#eef1f5',
  surface: '#ffffff',
  surface2: '#f7f9fb',
  sunk: '#e9edf2',
  text: '#141a23',
  muted: '#5b6572',
  subtle: '#98a2b0',
  border: '#e7eaef',
  brand: '#2f83bd',
  brandDeep: '#1f6390',
  brandSoft: '#e6f1f9',
  accent: '#ef8f14',
  accentDeep: '#c9740b',
  accentSoft: '#fcecd6',
  success: '#16a34a',
  successSoft: '#dcfce7',
  danger: '#e0453a',
  dangerSoft: '#fde8e6',
  violet: '#7c3aed',
  violetSoft: '#f0e9fd',
  onBrand: '#ffffff',
  onAccent: '#ffffff',
};

export type Colors = typeof lightColors;
export type Scheme = 'light' | 'dark';

export const darkColors: Colors = {
  bg: '#0b0f15',
  surface: '#151b23',
  surface2: '#1b222c',
  sunk: '#0f141b',
  text: '#e8edf3',
  muted: '#98a3b2',
  subtle: '#5f6a79',
  border: '#242d39',
  brand: '#54a6dd',
  brandDeep: '#82c1ea',
  brandSoft: '#152a3c',
  accent: '#f6a938',
  accentDeep: '#f6a938',
  accentSoft: '#2c2413',
  success: '#3ec77d',
  successSoft: '#123020',
  danger: '#f2685c',
  dangerSoft: '#3a1a17',
  violet: '#b794f6',
  violetSoft: '#241a38',
  onBrand: '#ffffff',
  onAccent: '#0b0f15',
};

export const radius = { sm: 12, md: 18, lg: 24, pill: 999 } as const;

/** Font families (loaded in the root layout). Custom fonts can't use
 *  `fontWeight` — each weight is its own family, so reference these directly. */
export const font = {
  display: 'SpaceGrotesk_600SemiBold', // titles + big numbers
  displayBold: 'SpaceGrotesk_700Bold',
  displayMed: 'SpaceGrotesk_500Medium',
  bodyRegular: 'Manrope_400Regular',
  body: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyHeavy: 'Manrope_800ExtraBold',
} as const;

/** Cap content width so phones fill the screen but tablets/landscape stay
 *  readable (centered column). Applied to scroll/list content containers. */
export const maxWidth = 640;
export const contentWidth = { width: '100%', maxWidth, alignSelf: 'center' } as const;

export type Tone = { bg: string; fg: string; bar: string };

/** Colour tone for a task's SLA / lateness state, resolved from the active
 *  theme's tokens (so it stays legible in both light and dark). */
export function slaTone(c: Colors, sla: string): Tone {
  switch (sla) {
    case 'breached':
      return { bg: c.dangerSoft, fg: c.danger, bar: c.danger };
    case 'at_risk':
      return { bg: c.accentSoft, fg: c.accentDeep, bar: c.accent };
    case 'resolved_on_time':
    case 'on_track':
      return { bg: c.successSoft, fg: c.success, bar: c.success };
    case 'blocked':
      return { bg: c.sunk, fg: c.muted, bar: c.subtle };
    default:
      return { bg: c.brandSoft, fg: c.brandDeep, bar: c.brand };
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
