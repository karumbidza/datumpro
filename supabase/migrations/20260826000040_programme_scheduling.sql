-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — programme scheduling: per-project auto-schedule + live dependencies
--
-- The programme (Gantt) gains direct manipulation: drag a bar to reschedule it,
-- and drag between bars to create a finish-to-start dependency. Two supports:
--
-- 1. `projects.auto_schedule` — an opt-in, per-project toggle. When on, moving a
--    task (or adding a link) cascades its dependent tasks forward so a successor
--    never starts before its predecessor finishes (+lag). Off by default so an
--    existing programme never reshuffles itself without the manager asking.
--
-- 2. `task_dependencies` joins the realtime publication. The table already existed
--    (with its cycle-check trigger and RLS) but was never published, so a link
--    created on one screen didn't live-refresh the programme on another. RLS is
--    still enforced per subscriber — a client only receives edges it may SELECT.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists auto_schedule boolean not null default false;

-- Publish task_dependencies for realtime, guarded so a re-run is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_dependencies'
  ) then
    alter publication supabase_realtime add table public.task_dependencies;
  end if;
end $$;
