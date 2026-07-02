-- ─────────────────────────────────────────────────────────────────────────────
-- Geotag task media
--
-- Site photos are captured in the field; where they were taken is evidence too.
-- Add optional GPS + capture-time columns to task_media (mirroring the columns
-- site_reports already carries). All nullable — location is best-effort and the
-- photo still uploads if the device denies location or has no fix. No RLS change:
-- these ride along with the existing task_media policies.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.task_media
  add column if not exists gps_lat     double precision,
  add column if not exists gps_lng     double precision,
  add column if not exists captured_at timestamptz;
