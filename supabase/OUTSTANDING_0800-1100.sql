-- DatumPro — OUTSTANDING migrations (apply after 0000–0700).
-- Paste this whole file into Supabase Studio > SQL Editor > Run. Order matters.
-- Sequence: 0800 (project isolation) -> 0900 (contractor/media) -> 1000 (sign-off/extensions) -> 1100 (quotes/cost-confidentiality).


-- ═══════════════════════════════════════════════════════════════════════
-- 20260101000800_project_isolation.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project-level isolation
--
-- Tenancy (the company) stays the outer boundary: org = customer, RLS on org_id,
-- composite (id, org_id) FKs make cross-tenant references impossible.
--
-- This migration adds the INNER boundary the product needs: within one company,
-- a project is an isolation unit. Two tiers of people:
--
--   • Company staff  — owner / admin / finance — see the WHOLE company
--     (the portfolio view). Owners & admins manage delivery; finance manages money.
--   • Project-scoped — anyone added to project_members (pm / contributor /
--     client / viewer) — see ONLY the projects they belong to. No leak between
--     projects.
--
-- Before this migration every read was gated by is_org_member(org_id), so any org
-- member could read every project's data. These policies replace that with
-- can_view_project(project_id, org_id) = is_org_staff(org) OR is_project_member(project).
--
-- Note: org-level role 'pm' is no longer a company-wide power role — "PM" is now a
-- per-project capability (project_members.role = 'pm'). Org admins create projects;
-- the project's PM (and admins) manage its tasks/members.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Access helpers (SECURITY DEFINER + hardened search_path, like is_org_member) ──
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.org_role(p_org_id) in ('owner', 'admin');
$$;

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.org_role(p_org_id) in ('owner', 'admin', 'finance');
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  );
$$;

create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pm.role::text from public.project_members pm
  where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  limit 1;
$$;

-- Can the caller READ this project's data? Company staff see all; otherwise the
-- caller must be a member of the project.
create or replace function public.can_view_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_staff(p_org_id) or public.is_project_member(p_project_id);
$$;

-- Can the caller MANAGE this project (create tasks/milestones, add members, …)?
-- Org admins manage any project; a project's PM manages that project.
create or replace function public.can_manage_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_admin(p_org_id) or public.project_role(p_project_id) = 'pm';
$$;

-- Parent resolvers for child tables that carry no project_id of their own.
create or replace function public.invoice_project(p_invoice_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.invoices where id = p_invoice_id;
$$;
create or replace function public.request_project(p_request_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.requests where id = p_request_id;
$$;
create or replace function public.task_project(p_task_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.tasks where id = p_task_id;
$$;

-- ── Creator joins their own project (so admins/PMs don't lock themselves out) ──
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.created_by, (select auth.uid()));
begin
  if v_user is not null then
    insert into public.project_members (org_id, project_id, user_id, role)
    values (new.org_id, new.id, v_user, 'pm')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- ─────────────────────────────────────────────────────────────────────────────
-- Policy rewrites. SELECT moves to project-aware visibility everywhere; WRITE is
-- tightened to project managers for delivery tables. Finance write policies stay
-- org-finance-scoped (back-office is company-wide by design); only their SELECT
-- becomes project-aware so clients/members can see their own project's money.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── projects ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using ((select public.can_view_project(id, org_id)));
drop policy if exists projects_write on public.projects;          -- replaced by split policies
create policy projects_insert on public.projects for insert
  with check ((select public.is_org_admin(org_id)));
create policy projects_update on public.projects for update
  using ((select public.can_manage_project(id, org_id)))
  with check ((select public.can_manage_project(id, org_id)));
create policy projects_delete on public.projects for delete
  using ((select public.is_org_admin(org_id)));

-- ── project_members ──
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── milestones ──
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── tasks ──
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check ((select public.can_manage_project(project_id, org_id)));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    assignee_id = (select auth.uid())
    or (select public.can_manage_project(project_id, org_id))
  )
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── task_dependencies (resolve project via the successor task) ──
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(successor_id)))
  );
drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies for all
  using (
    (select public.is_org_admin(org_id))
    or (select public.project_role(public.task_project(successor_id))) = 'pm'
  )
  with check (
    (select public.is_org_admin(org_id))
    or (select public.project_role(public.task_project(successor_id))) = 'pm'
  );

-- ── task_activity (resolve project via the task) ──
drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(task_id)))
  );
drop policy if exists task_activity_insert on public.task_activity;
create policy task_activity_insert on public.task_activity for insert
  with check (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(task_id)))
  );

-- ── site_reports ──
drop policy if exists site_reports_select on public.site_reports;
create policy site_reports_select on public.site_reports for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists site_reports_insert on public.site_reports;
create policy site_reports_insert on public.site_reports for insert
  with check ((select public.can_view_project(project_id, org_id)) and author_id = (select auth.uid()));
drop policy if exists site_reports_update on public.site_reports;
create policy site_reports_update on public.site_reports for update
  using (author_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists site_reports_delete on public.site_reports;
create policy site_reports_delete on public.site_reports for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── report_media ──
drop policy if exists report_media_select on public.report_media;
create policy report_media_select on public.report_media for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists report_media_insert on public.report_media;
create policy report_media_insert on public.report_media for insert
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists report_media_delete on public.report_media;
create policy report_media_delete on public.report_media for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── budget_lines ──
drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists budget_lines_write on public.budget_lines;
create policy budget_lines_write on public.budget_lines for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── variation_orders ──
drop policy if exists variation_orders_select on public.variation_orders;
create policy variation_orders_select on public.variation_orders for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists variation_orders_write on public.variation_orders;
create policy variation_orders_write on public.variation_orders for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── invoices (SELECT project-aware; write stays finance-scoped) ──
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using ((select public.can_view_project(project_id, org_id)));

-- ── invoice_lines (project via invoice) ──
drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── payment_schedule ──
drop policy if exists payment_schedule_select on public.payment_schedule;
create policy payment_schedule_select on public.payment_schedule for select
  using ((select public.can_view_project(project_id, org_id)));

-- ── payments (project via invoice) ──
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── proof_of_payments (project via invoice) ──
drop policy if exists proof_of_payments_select on public.proof_of_payments;
create policy proof_of_payments_select on public.proof_of_payments for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );
drop policy if exists proof_of_payments_insert on public.proof_of_payments;
create policy proof_of_payments_insert on public.proof_of_payments for insert
  with check (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── paynow_transactions (project via invoice) ──
drop policy if exists paynow_transactions_select on public.paynow_transactions;
create policy paynow_transactions_select on public.paynow_transactions for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── requests ──
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert
  with check ((select public.can_view_project(project_id, org_id)) and raised_by = (select auth.uid()));
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update
  using (raised_by = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── approvals (project via request) ──
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.request_project(request_id)))
  );

-- ── audit_logs (org admins only read the company audit trail) ──
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using ((select public.is_org_admin(org_id)));


-- ═══════════════════════════════════════════════════════════════════════
-- 20260101000900_task_commitments_media.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task commitments (contractor negotiation) + completion media
--
-- Closes the task loop end-to-end:
--   1. A PM offers a task to a contractor (a project member, role 'contractor').
--   2. The contractor accepts or declines; to accept they respond with a cost,
--      counter timeline, justification (scope of works), payment terms and an
--      attached quote → status 'accepted' or 'counter_proposed'.
--   3. The PM agrees (locks the cost — which becomes the task's Earned-Value
--      weight — and the payment terms) or declines / counters.
--   4. Completion requires media (photos/videos) + a closing report, then PM
--      sign-off.
--
-- Segregation of duties: the person who agrees a commitment cannot be the
-- contractor (DB CHECK). All new tables inherit project-level isolation, and the
-- storage policies are tightened from org-wide to project-scoped to match.
-- ─────────────────────────────────────────────────────────────────────────────

-- New project role. (Only compared as text in policies — never cast to the enum
-- in this migration — so it's safe to add and use policies in the same run.)
alter type public.project_role add value if not exists 'contractor';

-- Task carries the agreed cost (Earned-Value weight) and a closing-out report.
alter table public.tasks add column if not exists agreed_cost_cents bigint;
alter table public.tasks add column if not exists closing_report text;

create type public.commitment_status as enum (
  'offered', 'accepted', 'counter_proposed', 'agreed', 'declined', 'cancelled'
);

-- ── task_commitments — the offer/negotiation record (one per task) ──
create table public.task_commitments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  project_id       uuid not null,
  task_id          uuid not null,
  contractor_id    uuid references auth.users(id) on delete set null,
  status           public.commitment_status not null default 'offered',
  cost_cents       bigint,                              -- contractor's quote
  proposed_start   date,
  proposed_end     date,
  justification    text,                                -- scope of works
  payment_terms    jsonb not null default '{}'::jsonb,  -- {advancePct,retentionPct,milestones:[{label,pct}]}
  quote_path       text,                                -- storage path to quote/invoice
  responded_at     timestamptz,
  agreed_by        uuid references auth.users(id) on delete set null,
  agreed_cost_cents bigint,
  decided_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (task_id),
  -- Segregation of duties: whoever agrees can't be the contractor.
  constraint task_commitments_sod check (agreed_by is null or agreed_by <> contractor_id),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_commitments_task_idx       on public.task_commitments (task_id);
create index task_commitments_contractor_idx on public.task_commitments (contractor_id);

create trigger task_commitments_touch before update on public.task_commitments
  for each row execute function public.touch_updated_at();

-- ── task_media — completion evidence, quotes, progress photos ──
create table public.task_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  task_id      uuid not null,
  kind         text not null default 'photo',       -- photo | video | document
  purpose      text not null default 'completion',  -- completion | quote | progress
  storage_path text not null,
  caption      text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_media_task_idx on public.task_media (task_id);

-- ── RLS ──
alter table public.task_commitments enable row level security;
alter table public.task_media       enable row level security;

-- Commitments: everyone on the project can see; the PM/admin offers & decides;
-- the contractor (and the PM) can update during negotiation.
create policy task_commitments_select on public.task_commitments for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_commitments_insert on public.task_commitments for insert
  with check ((select public.can_manage_project(project_id, org_id)) and created_by = (select auth.uid()));
create policy task_commitments_update on public.task_commitments for update
  using (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)));
create policy task_commitments_delete on public.task_commitments for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- Media: project members can see & upload their own; managers or the uploader delete.
create policy task_media_select on public.task_media for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_media_insert on public.task_media for insert
  with check ((select public.can_view_project(project_id, org_id)) and uploaded_by = (select auth.uid()));
create policy task_media_delete on public.task_media for delete
  using (uploaded_by = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)));

-- ── Tighten storage to project-level isolation ──
-- Path is {org_id}/{project_id}/…/{file}; segment [2] is the project. Previously
-- gated by org membership only (any org member could read any project's media);
-- now gated by project access so a contractor on project A can't touch B's files.
drop policy if exists "project-media read" on storage.objects;
create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.can_view_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );

drop policy if exists "project-media upload" on storage.objects;
create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (select public.can_view_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );

drop policy if exists "project-media delete" on storage.objects;
create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.can_manage_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );


-- ═══════════════════════════════════════════════════════════════════════
-- 20260101001000_signoff_and_extensions.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project-PM sign-off + task extension requests
--
-- 1. Sign-off authority now follows the project model: a task can be approved to
--    DONE by an org owner/admin OR the project's PM (not just org-level roles).
--    This matches can_manage_project used everywhere else.
-- 2. Extension requests: the executor (contractor/assignee) asks for a new due
--    date with a reason; the PM approves (shifts the deadline — the CPM engine
--    then recomputes the schedule/critical path) or rejects. Baseline stays
--    frozen so variance remains visible.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Sign-off guard: org admin OR the project's PM (system context still allowed) ──
create or replace function public.guard_task_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    if (select auth.uid()) is not null
       and not public.can_manage_project(new.project_id, new.org_id) then
      raise exception 'only a project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$$;

-- ── Extension requests ──
create type public.extension_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.task_extension_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null,
  task_id           uuid not null,
  requested_by      uuid references auth.users(id) on delete set null,
  proposed_due_date date not null,
  reason            text,
  status            public.extension_status not null default 'pending',
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_extension_requests_task_idx on public.task_extension_requests (task_id);

alter table public.task_extension_requests enable row level security;

-- Everyone on the project sees them; the executor raises their own; the PM decides.
create policy task_extension_select on public.task_extension_requests for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_extension_insert on public.task_extension_requests for insert
  with check ((select public.can_view_project(project_id, org_id)) and requested_by = (select auth.uid()));
create policy task_extension_update on public.task_extension_requests for update
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));


-- ═══════════════════════════════════════════════════════════════════════
-- 20260101001100_task_quotes.sql
-- ═══════════════════════════════════════════════════════════════════════
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
