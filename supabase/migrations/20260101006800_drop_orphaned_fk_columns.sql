-- Tidy up orphaned columns left after retiring requests + invoicing + draws.
-- The approval engine keyed off (entity_type, entity_id) with request_id as a
-- legacy fallback; every row uses entity_id now, so drop the fallback from the
-- 3 approval functions AND the approvals_select policy, then drop the orphaned
-- columns (approvals.request_id, variation_orders.request_id, tasks.budget_line_id).

create or replace function public.enforce_approval_order()
  returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.decision is distinct from old.decision
     and new.decision in ('approved', 'rejected') then
    if exists (
      select 1 from public.approvals a
      where a.entity_type = new.entity_type
        and a.entity_id = new.entity_id
        and a.step_order < new.step_order
        and a.decision = 'pending'
    ) then
      raise exception 'An earlier approval step is still pending';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_approval_sod()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_requester uuid; et text; eid uuid;
begin
  if new.approver_id is null then return new; end if;
  et := new.entity_type;
  eid := new.entity_id;
  if et = 'variation' then
    select created_by into v_requester from public.variation_orders where id = eid;
  elsif et = 'extension' then
    select requested_by into v_requester from public.task_extension_requests where id = eid;
  elsif et = 'payment' then
    select contractor_id into v_requester from public.contractor_payment_requests where id = eid;
  elsif et = 'task_plan' then
    select assignee_id into v_requester from public.tasks where id = eid;
  elsif et = 'task_variation' then
    select created_by into v_requester from public.task_subtasks where id = eid;
  end if;
  if v_requester is not null and v_requester = new.approver_id then
    raise exception 'segregation of duties: the requester cannot approve their own request';
  end if;
  return new;
end;
$function$;

create or replace function public.finalize_approval()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := new.entity_type;
  eid := new.entity_id;
  if eid is null then return new; end if;

  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pend, rej
  from public.approvals
  where entity_type = et and entity_id = eid;

  if et = 'variation' then
    if rej > 0 then
      update public.variation_orders set status = 'rejected', decided_at = now()
        where id = eid and status not in ('rejected');
    elsif pend = 0 then
      update public.variation_orders set status = 'approved', approved_at = now(), decided_at = now()
        where id = eid and status = 'submitted';
    end if;
  elsif et = 'extension' then
    if rej > 0 then
      update public.task_extension_requests set status = 'rejected', decided_at = now()
        where id = eid and status = 'pending';
    elsif pend = 0 then
      update public.task_extension_requests set status = 'approved', decided_at = now()
        where id = eid and status = 'pending';
      update public.tasks t
        set due_date = e.proposed_due_date, planned_end_date = e.proposed_due_date
        from public.task_extension_requests e
        where e.id = eid and t.id = e.task_id;
    end if;
  elsif et = 'payment' then
    if rej > 0 then
      update public.contractor_payment_requests set status = 'rejected', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    elsif pend = 0 then
      update public.contractor_payment_requests set status = 'approved', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    end if;
  elsif et = 'task_plan' then
    if rej > 0 then
      update public.tasks set plan_submitted_at = null
        where id = eid and plan_approved_at is null;
    elsif pend = 0 then
      update public.tasks t set
        plan_approved_at   = now(),
        awarded_cost_cents = coalesce((
          select sum(s.cost_cents) from public.task_subtasks s
          where s.task_id = t.id
            and (s.is_variation = false or s.variation_status = 'approved')
        ), 0)
      where t.id = eid and t.plan_approved_at is null;
    end if;
  elsif et = 'task_variation' then
    if rej > 0 then
      update public.task_subtasks set variation_status = 'rejected'
        where id = eid and variation_status = 'pending';
    elsif pend = 0 then
      update public.task_subtasks set variation_status = 'approved'
        where id = eid and variation_status = 'pending';
      update public.tasks t set awarded_cost_cents = coalesce((
        select sum(s.cost_cents) from public.task_subtasks s
        where s.task_id = t.id
          and (s.is_variation = false or s.variation_status = 'approved')
      ), 0)
      from public.task_subtasks v
      where v.id = eid and t.id = v.task_id;
    end if;
  end if;
  return new;
end;
$function$;

drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select using (
  (select public.is_org_staff(org_id))
  or (select public.is_project_member(public.approval_project(entity_type, entity_id)))
);

alter table public.approvals drop column if exists request_id;
alter table public.variation_orders drop column if exists request_id;
alter table public.tasks drop column if exists budget_line_id;
