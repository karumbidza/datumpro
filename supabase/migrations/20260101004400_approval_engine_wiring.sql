-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — two-step approvals Stage 2 (engine wiring: visibility + effects)
--
-- 1. Approval steps for any entity must be visible to that entity's project
--    members (the request-only select policy hid extension/payment/variation
--    steps from PMs). 2. Finalising an extension now applies its effect — the
--    task deadline shifts — atomically in the trigger.
-- ─────────────────────────────────────────────────────────────────────────────

-- Resolve the owning project for any approvable entity.
create or replace function public.approval_project(p_entity_type text, p_entity_id uuid)
  returns uuid language sql stable security definer set search_path to ''
as $function$
  select case p_entity_type
    when 'request'   then (select project_id from public.requests where id = p_entity_id)
    when 'variation' then (select project_id from public.variation_orders where id = p_entity_id)
    when 'extension' then (select project_id from public.task_extension_requests where id = p_entity_id)
    when 'payment'   then (select project_id from public.contractor_payment_requests where id = p_entity_id)
    else null
  end;
$function$;

alter policy approvals_select on public.approvals using (
  (select public.is_org_staff(org_id))
  or (select public.is_project_member(
        public.approval_project(coalesce(entity_type, 'request'), coalesce(entity_id, request_id))
     ))
);

-- Finalizer + the extension effect (shift the task deadline on approval).
create or replace function public.finalize_approval()
  returns trigger language plpgsql security definer set search_path to ''
as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := coalesce(new.entity_type, 'request');
  eid := coalesce(new.entity_id, new.request_id);
  if eid is null then return new; end if;

  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pend, rej
  from public.approvals
  where coalesce(entity_type, 'request') = et and coalesce(entity_id, request_id) = eid;

  if et = 'request' then
    if rej > 0 then
      update public.requests set status = 'rejected', decided_at = now(), updated_at = now()
        where id = eid and status not in ('rejected', 'cancelled');
    elsif pend = 0 then
      update public.requests set status = 'approved', decided_at = now(), updated_at = now()
        where id = eid and status = 'submitted';
    end if;
  elsif et = 'variation' then
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
      -- Effect: shift the working deadline to the proposed date (baseline stays
      -- frozen so schedule variance stays visible).
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
  end if;
  return new;
end $function$;
