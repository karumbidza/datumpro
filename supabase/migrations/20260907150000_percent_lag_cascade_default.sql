-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — percent-based dependency lag + cascade-on-by-default
--
-- 1. task_dependencies.lag_percent — "successor starts at N% of the
--    predecessor" (Allen, 2026-09-07). When set, the TS scheduling engines
--    (shared CPM + web cascade) derive the effective lag dynamically from the
--    predecessor's CURRENT duration, so resizing the predecessor re-derives the
--    offset. lag_days is kept as a day-equivalent snapshot (written by the
--    dependency actions) so the SQL-side BOQ export scheduler — which only
--    reads lag_days — stays approximately right between cascades.
-- 2. New projects default to auto_schedule = true: "a delay in one delays the
--    whole chain" is the norm; PMs can still switch it off per project.
--    Existing projects keep their current setting.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.task_dependencies
  add column if not exists lag_percent numeric(5, 2)
  check (lag_percent is null or (lag_percent > 0 and lag_percent <= 100));

comment on column public.task_dependencies.lag_percent is
  'Start/finish offset as a percentage of the predecessor''s duration; when set it overrides lag_days in the TS engines (lag_days holds a day-equivalent snapshot for SQL consumers).';

alter table public.projects
  alter column auto_schedule set default true;
