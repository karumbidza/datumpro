/** Field monitoring — site reports captured on site (offline) and their media. */

export const REPORT_STATUSES = ['draft', 'submitted'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const MEDIA_TYPES = ['image', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const WEATHER_OPTIONS = ['clear', 'cloudy', 'rain', 'storm', 'wind', 'heat'] as const;
export type Weather = (typeof WEATHER_OPTIONS)[number];

/** Progress is an integer percentage 0–100; clamp defensively at the edges. */
export function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Tenant-scoped storage key for a piece of report media.
 *  Convention: {org_id}/{project_id}/{report_id}/{filename} — the storage RLS
 *  policies authorise on the first segment (org_id). */
export function mediaStoragePath(params: {
  orgId: string;
  projectId: string;
  reportId: string;
  filename: string;
}): string {
  const { orgId, projectId, reportId, filename } = params;
  return `${orgId}/${projectId}/${reportId}/${filename}`;
}
