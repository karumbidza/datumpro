-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project member disable / re-enable
--
-- Project membership was add/remove only (a hard delete). To disable a member on a
-- project without losing history (and to re-enable them later), add a status column
-- mirroring org_members.member_status. Crucially, DISABLING must revoke access:
-- is_project_member and project_role are the membership predicates behind every
-- project RLS policy, so they now require status='active'. A disabled member falls
-- out of the project entirely (no role, no visibility) until re-enabled; org admins
-- keep their org-level access regardless.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.project_members
  add column if not exists status public.member_status not null default 'active';

-- Membership predicate: a disabled member is no longer a member.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'
  ) and public.session_meets_org_mfa((select p.org_id from public.projects p where p.id = p_project_id));
$$;

-- Role resolution: a disabled member resolves to no role (so a disabled PM loses
-- manage rights, a disabled contractor loses contributor access, etc.).
create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.session_meets_org_mfa((select p.org_id from public.projects p where p.id = p_project_id))
    then (
      select pm.role::text from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = (select auth.uid())
        and pm.status = 'active'
      limit 1
    ) else null end;
$$;

-- Setup checklist counts only active members for the team / client-access items.
create or replace view public.project_setup_status
with (security_invoker = true) as
select
  p.id as project_id,
  (p.contract_value_cents > 0)                                        as commercial_done,
  (p.retention_pct is not null and p.payment_terms_days is not null)  as payment_terms_done,
  exists (select 1 from public.project_members m
          where m.project_id = p.id and m.status = 'active' and m.role in ('client', 'viewer')) as client_access_done,
  exists (select 1 from public.project_members m
          where m.project_id = p.id and m.status = 'active' and m.role = 'contributor')          as team_done,
  false                                                               as permit_done,
  false                                                               as insurance_done,
  exists (select 1 from public.tasks t where t.project_id = p.id)     as wbs_done,
  (p.latitude is not null)                                            as location_done
from public.projects p;

grant select on public.project_setup_status to authenticated;
