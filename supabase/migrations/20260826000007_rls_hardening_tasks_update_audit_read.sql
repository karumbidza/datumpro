-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — two RLS hardening fixes
--
-- M2. tasks_update: its WITH CHECK (can_view_project) was WEAKER than its USING
--     (assignee OR can_manage_project). A non-manager assignee passes USING (they
--     own the row) and the weak WITH CHECK let them write a NEW row that only
--     needs view scope — e.g. **reassign the task to someone else**. Tighten the
--     WITH CHECK to match the USING so a non-manager can only update a task that
--     stays assigned to them; reassignment now requires can_manage_project.
--
-- M3. audit_logs_select was owner/admin only (is_org_admin), leaving the finance
--     role unable to read the org audit trail it needs for reconciliation. Extend
--     read to the finance org role. (Still no write path — append-only stands.)
--
-- Validated in a rolled-back transaction: 6/6.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (assignee_id = (select auth.uid()))
    or (select public.can_manage_project(project_id, org_id))
  )
  with check (
    (assignee_id = (select auth.uid()))
    or (select public.can_manage_project(project_id, org_id))
  );

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (
    (select public.is_org_admin(org_id))
    or coalesce((select public.org_role(org_id)) = 'finance', false)
  );
