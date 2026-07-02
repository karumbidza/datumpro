-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile the org `pm` role as a company delivery manager
--
-- The shared permission map (packages/shared/src/access/permissions.ts) already
-- treats org role `pm` as a delivery manager — project:create, project:update,
-- budget:manage, finance:view, request/variation approvals — but the database
-- granted it none of that, so PMs experienced a contractor-shaped app. This
-- aligns RLS to that map with the smallest possible surface:
--
--   1. can_view_project() now includes org `pm` → portfolio visibility (they see
--      every project's tasks, budgets, invoices, milestones, reports, requests).
--   2. projects_insert now allows org `pm` → they can create projects. The
--      existing on_project_created trigger makes the creator that project's PM,
--      so they immediately manage what they create (can_manage_project).
--
-- Deliberately UNCHANGED, so authority stays coherent and money stays separated:
--   • can_manage_project() — an org PM manages projects they're the project PM
--     of (which now includes any they create), NOT every project org-wide.
--   • Money writes (invoices / payments / payment_schedule) stay owner/admin/
--     finance + project PM — an org PM cannot move money (separation of duties).
--   • task_quotes / payment_schedule SELECT are untouched — an org PM does not
--     see rival contractors' quotes or draws on projects they don't manage.
--   • guard_task_signoff already uses can_manage_project (project PM signs off).
-- ─────────────────────────────────────────────────────────────────────────────

-- Portfolio READ for delivery managers. Company staff (owner/admin/finance) and
-- now org PMs see across the org; everyone else is scoped to their memberships.
create or replace function public.can_view_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_staff(p_org_id)
      or public.org_role(p_org_id) = 'pm'
      or public.is_project_member(p_project_id);
$$;

-- Org admins and org PMs can start new projects; the creator trigger makes them
-- the project's PM so they manage it from there.
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');
