-- DB cleanup: retire the requests (RFI) feature and the never-wired invoicing
-- tables (all 0 rows, 0 live query refs). The generic approval functions lose
-- their 'request' branch; every other branch is unchanged. CASCADE on the table
-- drops removes the FK constraints from kept tables (approvals.request_id,
-- variation_orders.request_id, tasks.budget_line_id, payment_schedule.invoice_id)
-- — the harmless columns remain. request_type enum is kept (approval_policies uses it).

create or replace function public.approval_project(p_entity_type text, p_entity_id uuid)
 returns uuid language sql stable security definer set search_path to '' as $function$
  select case p_entity_type
    when 'variation'      then (select project_id from public.variation_orders where id = p_entity_id)
    when 'extension'      then (select project_id from public.task_extension_requests where id = p_entity_id)
    when 'payment'        then (select project_id from public.contractor_payment_requests where id = p_entity_id)
    when 'task_plan'      then (select project_id from public.tasks where id = p_entity_id)
    when 'task_variation' then (select t.project_id
                                  from public.task_subtasks s
                                  join public.tasks t on t.id = s.task_id
                                  where s.id = p_entity_id)
    else null
  end;
$function$;

create or replace function public.enforce_approval_sod()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_requester uuid; et text; eid uuid;
begin
  if new.approver_id is null then return new; end if;
  et := coalesce(new.entity_type, 'task_plan');
  eid := coalesce(new.entity_id, new.request_id);
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
end $function$;

create or replace function public.finalize_approval()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := coalesce(new.entity_type, 'task_plan');
  eid := coalesce(new.entity_id, new.request_id);
  if eid is null then return new; end if;

  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pend, rej
  from public.approvals
  where coalesce(entity_type, 'task_plan') = et and coalesce(entity_id, request_id) = eid;

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
end $function$;

delete from public.approval_policies where entity_type = 'request';
drop function if exists public.submit_request cascade;
drop function if exists public.finalize_request cascade;
drop function if exists public.request_project cascade;
drop function if exists public.invoice_project cascade;

drop table if exists public.requests cascade;
drop table if exists public.invitations cascade;
drop table if exists public.invoice_lines cascade;
drop table if exists public.proof_of_payments cascade;
drop table if exists public.paynow_transactions cascade;
drop table if exists public.payments cascade;
drop table if exists public.invoices cascade;
drop table if exists public.budget_lines cascade;
