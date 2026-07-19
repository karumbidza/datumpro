-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — scope PM visibility + admin-only project creation
--
-- Before: an org-level PM could VIEW every project in the org (can_view_project
-- granted blanket access to org_role='pm'), and PMs could CREATE projects.
-- After: a PM sees only projects they're a member of, and only owners/admins can
-- create projects. A PM gets a project by being ASSIGNED to it (project_members
-- role 'pm'), which grants both view (is_project_member) and manage
-- (can_manage_project via project_role='pm'). Owners/admins still see everything.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_view_project(p_project_id uuid, p_org_id uuid)
  returns boolean
  language sql stable security definer set search_path to ''
as $function$
  select public.is_org_staff(p_org_id)          -- owner / admin (finance dormant)
      or public.is_project_member(p_project_id); -- assigned to this project
$function$;

-- Project creation is now an owner/admin act only (PMs are assigned, not creators).
alter policy projects_insert on public.projects
  with check ((select public.is_org_admin(org_id)));
