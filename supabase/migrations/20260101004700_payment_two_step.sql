-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — two-step approvals Stage 2: payment requests
--
-- Seed the PM→Admin chain on every new payment request (amount-aware, so policy
-- thresholds can later make small ones single-step). finalize_approval already
-- flips requested→approved/rejected; here it also stamps the finalising approver
-- as reviewed_by. Payment (approved→paid) stays a separate finance action.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.seed_payment_approvals()
  returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.seed_approval_steps('payment', new.id, new.org_id, coalesce(new.amount_cents, 0));
  return new;
end $function$;

create trigger on_payment_created_seed
  after insert on public.contractor_payment_requests
  for each row execute function public.seed_payment_approvals();

-- Add reviewed_by to the payment finalize branch (whoever cast the last decision).
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
      update public.tasks t
        set due_date = e.proposed_due_date, planned_end_date = e.proposed_due_date
        from public.task_extension_requests e
        where e.id = eid and t.id = e.task_id;
    end if;
  elsif et = 'payment' then
    if rej > 0 then
      update public.contractor_payment_requests
        set status = 'rejected', reviewed_by = new.approver_id, reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    elsif pend = 0 then
      update public.contractor_payment_requests
        set status = 'approved', reviewed_by = new.approver_id, reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    end if;
  end if;
  return new;
end $function$;
