-- Staff are project-scoped (like contractors), not org-wide.
--
-- Until now is_org_staff() treated member_type='staff' as an internal role with
-- org-wide visibility — the whole project portfolio plus the BOQ / budget-rate
-- library. Product decision: internal staff are dedicated field/delivery workers
-- confined to the projects they belong to (the same scoping a contractor gets),
-- and must not see the BOQ library / budget rates (the money isn't theirs).
--
-- Drop 'staff' from the helper: owner/admin/pm stay org-wide; a staff member now
-- sees and acts only where they hold a project_members row (they are
-- auto-enrolled as a 'contributor' when assigned a task — see createTask /
-- ensureProjectMember). This is safe because every register / task / chat policy
-- pairs is_org_staff with an is_project_member / per-row (raised_by, created_by,
-- assignee_id, sender_id, …) / project-PM branch, so a staff member keeps full
-- access to their own projects. The only capabilities removed are org-scoped and
-- deliberately not theirs: the BOQ library reads (boqs / boq_sections /
-- boq_items / boq_tenders / boq_section_deps) and contractor-document review
-- (contractor_documents), which owner/admin/pm retain.

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.member_type in ('owner','admin','pm')
  );
$$;
revoke all on function public.is_org_staff(uuid) from public;
grant execute on function public.is_org_staff(uuid) to authenticated;
