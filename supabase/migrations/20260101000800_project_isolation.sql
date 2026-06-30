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
