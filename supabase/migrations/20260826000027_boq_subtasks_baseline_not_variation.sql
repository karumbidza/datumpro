-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ-generated subtasks are BASELINE scope, not variations
--
-- set_subtask_variation_flag flags any subtask inserted into a plan-approved task
-- as a variation. But export_award_to_project / generate_tasks_from_boq pre-approve
-- the plan BEFORE inserting the BOQ lines, so a task's own scope was mis-flagged
-- is_variation=true / 'pending' and shown as "Additional works". Vetted generation
-- sets app.workflow_ctx; when set the insert is baseline regardless of plan state.
-- Then backfill rows already mis-flagged.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_subtask_variation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approved timestamptz; v_submitted timestamptz;
begin
  if coalesce(nullif(current_setting('app.workflow_ctx', true), ''), '') <> '' then
    new.is_variation := coalesce(new.is_variation, false);
    if not new.is_variation then new.variation_status := null; end if;
    return new;
  end if;
  select plan_approved_at, plan_submitted_at into v_approved, v_submitted
    from public.tasks where id = new.task_id;
  if v_approved is not null then
    new.is_variation := true; new.variation_status := 'pending';
  elsif v_submitted is not null then
    raise exception 'The plan is awaiting approval and cannot be changed right now';
  else
    new.is_variation := false; new.variation_status := null;
  end if;
  return new;
end $$;

-- Backfill: BOQ-sourced subtasks wrongly flagged as pending/rejected variations.
-- variation_status is a guarded workflow column (guard_workflow_transition), so
-- the write must run with app.workflow_ctx set to the row's org_id — do it per
-- org. (Empty on a fresh DB, so this is a no-op in CI; it corrects real prod rows.)
create temporary table _fix on commit drop as
  select id, task_id, org_id from public.task_subtasks
  where boq_item_id is not null and is_variation = true and variation_status is distinct from 'approved';

do $$
declare v_org uuid;
begin
  for v_org in select distinct org_id from _fix loop
    perform set_config('app.workflow_ctx', v_org::text, true);

    delete from public.approvals
      where entity_type = 'task_variation'
        and entity_id in (select id from _fix where org_id = v_org);

    update public.task_subtasks
      set is_variation = false, variation_status = null
      where id in (select id from _fix where org_id = v_org);
  end loop;
  perform set_config('app.workflow_ctx', '', true);
end $$;

-- Recompute awarded_cost_cents for the affected tasks (baseline + approved sum).
-- awarded_cost_cents is NOT a guarded column, so this needs no workflow ctx.
update public.tasks t
  set awarded_cost_cents = coalesce((
    select sum(s.cost_cents) from public.task_subtasks s
    where s.task_id = t.id and (s.is_variation = false or s.variation_status = 'approved')), 0)
  where t.id in (select distinct task_id from _fix);
