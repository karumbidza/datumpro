-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — fix: approving a task_variation must grow the task's awarded_cost_cents.
--
-- The item-variations design (20260826000005) states the actual cost = tasks.
-- awarded_cost_cents, "which already grows with approved variations", and the
-- task_cost_variance view reads awarded_cost_cents as actual_cost_cents. But
-- finalize_approval's `task_variation` branch only set variation_status='approved'
-- and never recomputed awarded_cost_cents — so an approved variation was invisible
-- in the task's locked total and in the variance view's actuals. The `task_plan`
-- branch already recomputes it (sum of non-variation + approved-variation lines);
-- apply the same recompute after a variation is approved. Body is otherwise
-- identical to the live finalize_approval.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.finalize_approval()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := new.entity_type; eid := new.entity_id;
  if eid is null then return new; end if;
  perform set_config('app.workflow_ctx', new.org_id::text, true);
  select count(*) filter (where decision='pending'), count(*) filter (where decision='rejected')
    into pend, rej from public.approvals where entity_type=et and entity_id=eid;
  if et = 'payment' then
    if rej > 0 then
      update public.contractor_payment_requests set status='rejected', reviewed_at=now(), updated_at=now() where id=eid and status='requested';
    elsif pend = 0 then
      update public.contractor_payment_requests set status='approved', reviewed_at=now(), updated_at=now() where id=eid and status='requested';
    end if;
  elsif et = 'extension' then
    if rej > 0 then
      update public.task_extension_requests set status='rejected', decided_at=now() where id=eid and status='pending';
    elsif pend = 0 then
      update public.task_extension_requests set status='approved', decided_at=now() where id=eid and status='pending';
      update public.tasks t set due_date=e.proposed_due_date, planned_end_date=e.proposed_due_date
        from public.task_extension_requests e where e.id=eid and t.id=e.task_id;
    end if;
  elsif et = 'task_plan' then
    if rej > 0 then update public.tasks set plan_submitted_at=null where id=eid and plan_approved_at is null;
    elsif pend = 0 then
      update public.tasks t set plan_approved_at=now(),
        awarded_cost_cents=coalesce((select sum(s.cost_cents) from public.task_subtasks s where s.task_id=t.id and (s.is_variation=false or s.variation_status='approved')),0)
      where t.id=eid and t.plan_approved_at is null;
    end if;
  elsif et = 'task_variation' then
    if rej > 0 then update public.task_subtasks set variation_status='rejected' where id=eid and variation_status='pending';
    elsif pend = 0 then
      update public.task_subtasks set variation_status='approved' where id=eid and variation_status='pending';
      -- Approving a variation grows the task's locked total (same recompute as task_plan).
      update public.tasks t set awarded_cost_cents=coalesce(
        (select sum(s.cost_cents) from public.task_subtasks s
          where s.task_id=t.id and (s.is_variation=false or s.variation_status='approved')),0)
      where t.id=(select task_id from public.task_subtasks where id=eid);
    end if;
  elsif et = 'variation' then
    if rej > 0 then update public.variation_orders set status='rejected', decided_at=now() where id=eid and status not in ('rejected');
    elsif pend = 0 then update public.variation_orders set status='approved', approved_at=now(), decided_at=now() where id=eid and status='submitted'; end if;
  end if;
  perform set_config('app.workflow_ctx','', true);
  return new;
end;
$function$;
