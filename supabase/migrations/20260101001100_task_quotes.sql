-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — multi-contractor quotes (RFQ) + cost confidentiality
--
-- Supersedes the single-offer commitment: a task can be sent to several
-- contractors to quote; each submits privately; the PM compares and awards one.
-- Losing quotes are retained (not_selected) inside the project for audit.
--
-- Cost confidentiality: a quote's amount is visible ONLY to company staff
-- (owner/admin/finance), the project's PM, and the contractor who owns the quote.
-- Other contractors/members still see the task, project and assignee (tasks RLS is
-- unchanged) but never a price. Because Postgres RLS is row-level, cost is kept
-- out of the broadly-readable `tasks` table and held only here, where the row
-- policy hides rival quotes entirely.
-- ─────────────────────────────────────────────────────────────────────────────

-- Retire the single-offer model (nothing is deployed on it yet).
drop table if exists public.task_commitments cascade;
drop type if exists public.commitment_status;

-- Cost must not live on the tasks table (a column can't be hidden per-row by RLS).
alter table public.tasks drop column if exists agreed_cost_cents;

create type public.quote_status as enum (
  'invited', 'submitted', 'declined', 'awarded', 'not_selected'
);

create table public.task_quotes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null,
  task_id        uuid not null,
  contractor_id  uuid not null references auth.users(id) on delete cascade,
  status         public.quote_status not null default 'invited',
  cost_cents     bigint,                              -- CONFIDENTIAL
  proposed_start date,
  proposed_end   date,
  justification  text,                                -- scope of works / cost basis
  payment_terms  jsonb not null default '{}'::jsonb,
  quote_path     text,                                -- storage path (private per quote)
  submitted_at   timestamptz,
  decided_at     timestamptz,
  created_by     uuid references auth.users(id) on delete set null,  -- the PM who invited
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (task_id, contractor_id),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_quotes_task_idx       on public.task_quotes (task_id);
create index task_quotes_contractor_idx on public.task_quotes (contractor_id);

create trigger task_quotes_touch before update on public.task_quotes
  for each row execute function public.touch_updated_at();

-- ── RLS — cost confidentiality lives in the SELECT policy ──
alter table public.task_quotes enable row level security;

create policy task_quotes_select on public.task_quotes for select
  using (
    (select public.is_org_staff(org_id))                 -- owner/admin/finance
    or (select public.project_role(project_id)) = 'pm'   -- the project's PM
    or contractor_id = (select auth.uid())               -- the quote's own contractor
  );
create policy task_quotes_insert on public.task_quotes for insert
  with check ((select public.can_manage_project(project_id, org_id)) and created_by = (select auth.uid()));
create policy task_quotes_update on public.task_quotes for update
  using (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)));
create policy task_quotes_delete on public.task_quotes for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── Keep quote documents confidential too (completion/progress media stay open
--    to the project; quote-purpose media is limited to staff/PM/uploader). ──
drop policy if exists task_media_select on public.task_media;
create policy task_media_select on public.task_media for select
  using (
    (select public.can_view_project(project_id, org_id))
    and (
      purpose <> 'quote'
      or (select public.is_org_staff(org_id))
      or (select public.project_role(project_id)) = 'pm'
      or uploaded_by = (select auth.uid())
    )
  );
