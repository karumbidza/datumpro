-- Staff-assigned tasks carry NO monetary value.
--
-- Internal staff are salaried employees, not per-task contractors, so a task
-- assigned to a staff member must never enter the accept → price → pay flow:
-- no "accept & price", no awarded value, no payment tab, no personal statement.
--
-- The whole money machinery keys off tasks.acceptance_status (usesPlanFlow),
-- plan_approved_at + awarded_cost_cents (getTaskPaymentInfo / listMyOwed). The
-- single switch that turns it on is set_task_pending_on_assign(), which
-- 20260101005900 changed to fire for ALL assignees. We re-introduce a filter —
-- keyed on member_type, since staff/admin/pm all share the 'contributor'
-- PROJECT role and so project role cannot distinguish them — so that a STAFF
-- assignee keeps acceptance_status = null (plain checklist) and any money
-- columns carried over from a previous contractor assignee are cleared.
--
-- accept_and_price_task already rejects a task whose acceptance_status is not
-- 'pending', so staff tasks are automatically barred from that RPC too — no
-- extra guard needed.

-- Based verbatim on the current definition (20260101009500_export_award_reprice)
-- — which deletes only PERSONAL plan lines (keeps boq_item_id bill lines) and
-- gates the acceptance flow on the contractor/contributor project role — with a
-- single staff branch added ahead of it.
create or replace function public.set_task_pending_on_assign()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    new.rejected_reason := null;
    if tg_op = 'UPDATE' then
      delete from public.task_subtasks
        where task_id = new.id and boq_item_id is null;  -- fresh personal plan; keep bill lines
    end if;

    if exists (
      select 1 from public.org_members m
      where m.org_id = new.org_id
        and m.user_id = new.assignee_id
        and m.member_type = 'staff'
    ) then
      -- Salaried staff: no monetary value on the task. Stay on the plain
      -- checklist and wipe any money carried over from a prior contractor
      -- assignee. plan_approved_at is workflow-guarded, so authorise its clear
      -- for this org (mirrors accept_and_price_task).
      perform set_config('app.workflow_ctx', new.org_id::text, true);
      new.acceptance_status := null;
      new.accepted_at := null;
      new.awarded_cost_cents := null;
      new.plan_approved_at := null;
      new.works_notes := null;
    elsif coalesce(new.acceptance_status, 'pending') <> 'accepted'
       and exists (
         select 1 from public.project_members pm
         where pm.project_id = new.project_id
           and pm.user_id = new.assignee_id
           and pm.role in ('contractor', 'contributor')
       )
    then
      new.acceptance_status := 'pending';
      new.accepted_at := null;
    end if;
  end if;
  return new;
end;
$function$;

-- ── Backfill: existing staff-assigned, not-done tasks ────────────────────────
-- The 20260101005900 backfill flipped these to 'pending'; undo that for staff.
-- These are plain column updates (assignee unchanged), so the trigger above
-- does not fire and no checklist/subtask rows are deleted.

-- Unguarded money columns in one bulk statement.
update public.tasks t
   set acceptance_status = null,
       accepted_at = null,
       awarded_cost_cents = null,
       works_notes = null
  from public.org_members m
 where m.org_id = t.org_id
   and m.user_id = t.assignee_id
   and m.member_type = 'staff'
   and t.status <> 'done'
   and (t.acceptance_status is not null
        or t.accepted_at is not null
        or t.awarded_cost_cents is not null
        or t.works_notes is not null);

-- plan_approved_at is workflow-guarded (may only change when app.workflow_ctx =
-- the row's org_id), so clear it per-org.
do $$
declare
  r record;
begin
  for r in
    select distinct t.org_id
      from public.tasks t
      join public.org_members m
        on m.org_id = t.org_id and m.user_id = t.assignee_id
     where m.member_type = 'staff'
       and t.status <> 'done'
       and t.plan_approved_at is not null
  loop
    perform set_config('app.workflow_ctx', r.org_id::text, true);
    update public.tasks t
       set plan_approved_at = null
      from public.org_members m
     where m.org_id = t.org_id
       and m.user_id = t.assignee_id
       and m.member_type = 'staff'
       and t.org_id = r.org_id
       and t.status <> 'done'
       and t.plan_approved_at is not null;
  end loop;
end $$;
