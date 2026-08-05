-- ─────────────────────────────────────────────────────────────────────────────
-- Security assessment F2 — enforce org-required MFA at the DATA LAYER
--
-- Before this migration, `organizations.require_mfa` was enforced only by a UI
-- redirect in app/(app)/layout.tsx. A determined user whose session was still at
-- AAL1 (password only, second factor not yet presented) could bypass the UI and
-- hit PostgREST/the API directly to read or write org data. This adds the check
-- to the database so the requirement holds no matter how the request arrives.
--
-- Mechanism: the entire RLS surface funnels through four membership helpers —
--   • is_org_member(org_id)      → SELECT visibility on org-scoped tables
--   • org_role(org_id)           → owner/admin/pm/… write & admin predicates
--   • is_project_member(proj_id) → project read surface (via can_view_project)
--   • project_role(proj_id)      → project manage surface (via can_manage_project)
-- Gating these four with an AAL check propagates MFA enforcement to every policy
-- that derives from them (is_org_admin, is_org_staff, can_view_project,
-- can_manage_project, and all inline org_role/project_role predicates) without
-- editing ~90 individual policies.
--
-- Fail-safe on the read path: when an AAL1 session hits a require_mfa org, the
-- membership helpers return false/NULL, so the app-shell layout would see "no
-- memberships" and fall through to onboarding instead of the /mfa prompt. To
-- keep the UX correct we add mfa_required_pending(), an AAL-INDEPENDENT helper
-- the layout calls first to decide the /mfa redirect.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── AAL primitives ───────────────────────────────────────────────────────────

-- The assurance level of the current request's JWT ('aal1' password-only, 'aal2'
-- second factor presented). Defaults to 'aal1' when the claim is absent so an
-- unknown state is treated as the weaker one.
create or replace function public.session_aal()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;

-- True unless the org requires MFA and the session hasn't reached AAL2. Orgs that
-- don't require MFA (require_mfa = false / NULL) always pass.
create or replace function public.session_meets_org_mfa(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select o.require_mfa from public.organizations o where o.id = p_org_id), false)
      then public.session_aal() = 'aal2'
    else true
  end;
$$;

-- AAL-independent: does the current user belong to any active org that requires
-- MFA while their session is below AAL2? The app-shell layout calls this to send
-- the user to /mfa — it must work even though the membership helpers below are
-- returning nothing for this same (AAL1) session.
create or replace function public.mfa_required_pending()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and o.require_mfa = true
  ) and public.session_aal() <> 'aal2';
$$;
grant execute on function public.mfa_required_pending() to authenticated;

-- ── Re-define the four choke-point helpers with the AAL gate ──────────────────
-- Signatures are unchanged; only the body gains the session_meets_org_mfa guard.

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
  ) and public.session_meets_org_mfa(p_org_id);
$$;

-- Returns NULL when the AAL gate fails, so every `org_role(x) in (…)` predicate
-- evaluates to unknown → not-true (access denied). The one negation site
-- (guard_task_signoff) is made NULL-safe below.
create or replace function public.org_role(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when public.session_meets_org_mfa(p_org_id) then (
    select m.role::text from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
    limit 1
  ) else null end;
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  ) and public.session_meets_org_mfa((select p.org_id from public.projects p where p.id = p_project_id));
$$;

create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.session_meets_org_mfa((select p.org_id from public.projects p where p.id = p_project_id))
    then (
      select pm.role::text from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
      limit 1
    ) else null end;
$$;

-- ── NULL-safe hardening of the one org_role negation ──────────────────────────
-- guard_task_signoff previously read `org_role(...) not in ('owner','admin','pm')`.
-- With org_role now able to return NULL (AAL gate), coalesce to 'viewer' so a
-- gated/non-member session still fails the privilege check and the sign-off is
-- rejected rather than silently allowed.
create or replace function public.guard_task_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    -- auth.uid() is null for system/service contexts (Inngest, webhooks) → allowed.
    if (select auth.uid()) is not null
       and coalesce(public.org_role(new.org_id), 'viewer') not in ('owner', 'admin', 'pm') then
      raise exception 'only a project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$$;
