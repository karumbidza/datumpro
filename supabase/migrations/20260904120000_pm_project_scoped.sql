-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — confine PMs to their assigned projects (data layer)
--
-- Finishes the project-scoping programme (staff: 20260903140000). A
-- member_type='pm' user could still reach EVERY project in the org because
-- is_org_staff() counted 'pm' as org-wide management — assigning a PM to one
-- project was meaningless for access. From here on a PM sees and manages only
-- the projects where they hold a project_members role='pm' row (they may hold
-- several — multi-project PMs are supported and unchanged).
--
-- What a PM keeps, per row-level fallbacks that already exist on every family:
--   · projects/tasks/registers/chat/payments READ  → is_project_member branch
--   · management WRITE on their own projects       → project_role='pm' branch
--   · the BOQ attached to their own project        → new project-PM read branch
-- What a PM loses (org-wide, deliberately — owner/admin only now):
--   · the org BOQ/rate library and its sections/items/deps (read + write)
--   · sealed tenders: read, create, invite, unseal, award, bid access,
--     invite-token rotation, BOQ→task generation/scheduling/award export
--   · contractor compliance documents (rode on is_org_staff)
--   · org client records WRITE (reads stay org-member-wide)
--   · granting the project-PM role (owner/admin assign PMs now)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ▸ is_org_staff(): org-wide management is owner/admin only.
create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.member_type in ('owner','admin')
  );
$$;

-- 2 ▸ A PM still reads the BOQ *linked to a project they manage* (the project
--     BOQ tab), without seeing the org-wide library.
create or replace function public.is_project_pm_for_boq(p_boq_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boqs b
    where b.id = p_boq_id
      and b.project_id is not null
      and coalesce(public.project_role(b.project_id) = 'pm', false)
  );
$$;

drop policy if exists boqs_select on public.boqs;
create policy boqs_select on public.boqs for select
  using ((select public.is_org_staff(org_id)) or (select public.is_project_pm_for_boq(id)));

drop policy if exists boq_sections_select on public.boq_sections;
create policy boq_sections_select on public.boq_sections for select
  using ((select public.is_org_staff(org_id)) or (select public.is_project_pm_for_boq(boq_id)));

drop policy if exists boq_items_select on public.boq_items;
create policy boq_items_select on public.boq_items for select
  using (
    (select public.is_org_staff(org_id))
    or exists (
      select 1 from public.boq_sections s
      where s.id = boq_items.section_id and public.is_project_pm_for_boq(s.boq_id)
    )
  );

drop policy if exists boq_section_deps_select on public.boq_section_deps;
create policy boq_section_deps_select on public.boq_section_deps for select
  using (
    (select public.is_org_staff(org_id))
    or exists (
      select 1 from public.boq_sections s
      where s.id = boq_section_deps.section_id and public.is_project_pm_for_boq(s.boq_id)
    )
  );

-- 3 ▸ Org-wide estimating/tender/client WRITES: drop the org_role='pm' branch.
drop policy if exists boqs_write on public.boqs;
create policy boqs_write on public.boqs for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

drop policy if exists boq_sections_write on public.boq_sections;
create policy boq_sections_write on public.boq_sections for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

drop policy if exists boq_items_write on public.boq_items;
create policy boq_items_write on public.boq_items for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

drop policy if exists boq_section_deps_write on public.boq_section_deps;
create policy boq_section_deps_write on public.boq_section_deps for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

drop policy if exists boq_tenders_write on public.boq_tenders;
create policy boq_tenders_write on public.boq_tenders for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

drop policy if exists boq_bidders_staff on public.boq_bidders;
create policy boq_bidders_staff on public.boq_bidders for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

-- Unsealed-bid reads stay gated on unsealing; only the who narrows.
drop policy if exists boq_bid_items_staff_read on public.boq_bid_items;
create policy boq_bid_items_staff_read on public.boq_bid_items for select
  using (
    (select public.is_org_admin(org_id))
    and exists (
      select 1 from public.boq_bidders bd
      join public.boq_tenders t on t.id = bd.tender_id
      where bd.id = boq_bid_items.bidder_id and t.unsealed_at is not null
    )
  );

drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

-- Only owner/admin grant (or revoke-by-grant) the project-PM role now. A
-- project PM still manages their own team for every other role.
drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check (
    (select public.can_manage_project(project_id, org_id))
    and (role <> 'pm' or (select public.is_org_admin(org_id)))
  );

-- 4 ▸ Tender/BOQ RPC guards: every function below embeds the identical line
--       coalesce(is_org_admin(v_org), false) or coalesce(org_role(v_org),'') = 'pm'
--     Rewrite each definition in place (from live catalog truth, not a copy of
--     an old migration) to the is_org_admin()-only form. Raises if a function
--     is missing or its guard has drifted, so this can never silently no-op.
do $$
declare
  v_names constant text[] := array[
    'create_tender','invite_boq_bidder','unseal_tender','award_boq_tender',
    'generate_tasks_from_boq','export_award_to_project','schedule_boq_tasks',
    'rotate_bid_invite_token'
  ];
  v_old constant text :=
    'coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '''') = ''pm''';
  v_new constant text := 'coalesce(public.is_org_admin(v_org), false)';
  v_name text;
  v_oid oid;
  v_def text;
  v_patched text;
begin
  foreach v_name in array v_names loop
    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_oid is null then
      raise exception 'pm_project_scoped: function public.% not found', v_name;
    end if;
    v_def := pg_get_functiondef(v_oid);
    v_patched := replace(v_def, v_old, v_new);
    if v_patched = v_def then
      raise exception 'pm_project_scoped: guard not found in public.% — definition drifted, update this migration', v_name;
    end if;
    execute v_patched;
  end loop;
end $$;
