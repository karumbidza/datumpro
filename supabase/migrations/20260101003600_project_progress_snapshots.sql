-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project progress snapshots (burn-up)
--
-- A daily cron writes each project's % into this table so the overview can show
-- a progress-over-time trend. Read for project viewers; only the cron (service
-- role) writes, so there's no insert policy.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.project_progress_snapshots (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  day        date not null,
  pct        int  not null,
  created_at timestamptz not null default now(),
  unique (project_id, day)
);
create index project_progress_snapshots_idx on public.project_progress_snapshots (project_id, day);

alter table public.project_progress_snapshots enable row level security;

create policy pps_select on public.project_progress_snapshots for select
  using ((select public.can_view_project(project_id, org_id)));
