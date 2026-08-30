-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — register visibility & role hardening
--
-- The site-diary / snagging / RFI registers shipped with SELECT policies of
-- `is_project_member OR is_org_staff`, which let EVERY project member — including
-- external `client` and `viewer` members — read them, and let every contractor on
-- a multi-sub project read every other contractor's RFIs and assigned defects.
-- Snag lifecycle transitions documented as "PM verifies" were also enforced only
-- by an RLS predicate that admits the raiser and assignee, so a contractor could
-- self-verify their own defect.
--
-- Product decisions (owner-confirmed):
--   • Snags / Site diary / RFIs are INTERNAL: staff + contractors see them;
--     clients and viewers do not.
--   • On a multi-contractor project a contractor sees only the RFIs/snags they
--     raised or are assigned to; PM / org-staff see all. (Site diary is a shared
--     internal log — not per-contractor scoped.)
--   • Only a PM / org-staff may verify, reopen or charge a snag.
--   • Variations keep client-visible cost/time (transparency) — unchanged here.
--
-- Contractors are org member_type = 'contractor' (mapped onto project role
-- 'contributor'), so distinguishing them from internal staff needs member_type,
-- not project_role. This adds an MFA-gated `org_member_type()` helper for that.
-- ─────────────────────────────────────────────────────────────────────────────

-- Caller's active member_type in an org (text), or NULL when not an active member
-- or the org's MFA requirement isn't met this session. Mirrors project_role()'s
-- MFA gating so a stepped-down session sees nothing.
create or replace function public.org_member_type(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.session_meets_org_mfa(p_org_id) then (
      select om.member_type::text
        from public.org_members om
       where om.org_id = p_org_id
         and om.user_id = (select auth.uid())
         and om.status = 'active'
       limit 1
    ) else null end;
$$;
revoke all on function public.org_member_type(uuid) from public;
grant execute on function public.org_member_type(uuid) to authenticated;

-- ── snags: internal-only, contractor sees own ───────────────────────────────
drop policy if exists snags_select on public.snags;
create policy snags_select on public.snags for select
  using (
    (select public.is_org_staff(org_id))
    or (
      (select public.is_project_member(project_id))
      and (
        coalesce((select public.project_role(project_id)) = 'pm', false)
        or (select public.org_member_type(org_id)) in ('owner', 'admin', 'pm', 'finance', 'staff')
        or (
          (select public.org_member_type(org_id)) = 'contractor'
          and (raised_by = (select auth.uid()) or assignee_id = (select auth.uid()))
        )
      )
    )
  );

-- snag photos follow their parent snag's visibility.
drop policy if exists snag_photos_select on public.snag_photos;
create policy snag_photos_select on public.snag_photos for select
  using (
    exists (
      select 1 from public.snags s
       where s.id = snag_photos.snag_id
         and (
           (select public.is_org_staff(s.org_id))
           or (
             (select public.is_project_member(s.project_id))
             and (
               coalesce((select public.project_role(s.project_id)) = 'pm', false)
               or (select public.org_member_type(s.org_id)) in ('owner', 'admin', 'pm', 'finance', 'staff')
               or (
                 (select public.org_member_type(s.org_id)) = 'contractor'
                 and (s.raised_by = (select auth.uid()) or s.assignee_id = (select auth.uid()))
               )
             )
           )
         )
    )
  );

-- Only a PM / org-staff may verify, reopen or charge a snag. The contractor can
-- still move it open→fixed (not in the guarded set) via the update policy.
create or replace function public.guard_snag_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and new.status in ('verified', 'reopened', 'charged')
     and not (
       public.is_org_staff(new.org_id)
       or coalesce(public.project_role(new.project_id) = 'pm', false)
     )
  then
    raise exception 'Only a project manager can verify, reopen or charge a snag';
  end if;
  return new;
end $$;

drop trigger if exists guard_snag_transition_trg on public.snags;
create trigger guard_snag_transition_trg before update on public.snags
  for each row execute function public.guard_snag_transition();

-- ── RFIs: internal-only, contractor sees own ────────────────────────────────
drop policy if exists rfis_select on public.rfis;
create policy rfis_select on public.rfis for select
  using (
    (select public.is_org_staff(org_id))
    or (
      (select public.is_project_member(project_id))
      and (
        coalesce((select public.project_role(project_id)) = 'pm', false)
        or (select public.org_member_type(org_id)) in ('owner', 'admin', 'pm', 'finance', 'staff')
        or (
          (select public.org_member_type(org_id)) = 'contractor'
          and (raised_by = (select auth.uid()) or assignee_id = (select auth.uid()))
        )
      )
    )
  );

-- RFI attachments follow their parent RFI's visibility.
drop policy if exists rfi_attachments_select on public.rfi_attachments;
create policy rfi_attachments_select on public.rfi_attachments for select
  using (
    exists (
      select 1 from public.rfis r
       where r.id = rfi_attachments.rfi_id
         and (
           (select public.is_org_staff(r.org_id))
           or (
             (select public.is_project_member(r.project_id))
             and (
               coalesce((select public.project_role(r.project_id)) = 'pm', false)
               or (select public.org_member_type(r.org_id)) in ('owner', 'admin', 'pm', 'finance', 'staff')
               or (
                 (select public.org_member_type(r.org_id)) = 'contractor'
                 and (r.raised_by = (select auth.uid()) or r.assignee_id = (select auth.uid()))
               )
             )
           )
         )
    )
  );

-- ── Site diary: internal-only (staff + contractors), hidden from client/viewer ─
-- Not per-contractor scoped — the diary is a shared internal record of the day.
drop policy if exists site_diary_entries_select on public.site_diary_entries;
create policy site_diary_entries_select on public.site_diary_entries for select
  using (
    (select public.is_org_staff(org_id))
    or (
      (select public.is_project_member(project_id))
      and (select public.org_member_type(org_id)) not in ('client', 'viewer')
    )
  );

drop policy if exists site_diary_photos_select on public.site_diary_photos;
create policy site_diary_photos_select on public.site_diary_photos for select
  using (
    (select public.is_org_staff(org_id))
    or (
      (select public.is_project_member(project_id))
      and (select public.org_member_type(org_id)) not in ('client', 'viewer')
    )
  );
