-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — cover the FKs flagged as unindexed by the performance advisor.
-- All three were introduced by recent migrations (clients, calendars, setup).
-- A covering index speeds joins and FK cascade/lookup checks.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists clients_created_by_idx on public.clients (created_by);
create index if not exists project_progress_snapshots_org_idx on public.project_progress_snapshots (org_id);
create index if not exists projects_calendar_idx on public.projects (calendar_id);
