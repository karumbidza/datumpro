-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — make the admin/manage guard helpers NULL-safe at the source.
--
-- is_org_admin() = `org_role(x) in ('owner','admin')` returned NULL for a non-member
-- (org_role is NULL then, and `NULL in (...)` is NULL). can_manage_project() likewise
-- went NULL when both is_org_admin and project_role were NULL. Any imperative guard
-- `if not <helper> then raise` treats NULL as "not true" → the raise is skipped → a
-- non-member (or an MFA-pending session, since org_role() is NULL until MFA is met)
-- slips through SECURITY DEFINER bodies guarded this way (e.g. award_tender,
-- set_org_approval_policy). Coalescing to a definite boolean closes the whole class.
--
-- RLS policies are unaffected: NULL and false both fail a USING/WITH CHECK the same way.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.org_role(p_org_id) in ('owner', 'admin'), false);
$$;

create or replace function public.can_manage_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_admin(p_org_id)
      or coalesce(public.project_role(p_project_id) = 'pm', false);
$$;
