-- A payment request must be raised by the task's assignee, against an approved
-- plan, for no more than what's still claimable, with an invoice. Enforced at
-- the DB so web, mobile, and API all obey.
create or replace function public.enforce_payment_request_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare v_assignee uuid; v_awarded bigint; v_approved timestamptz; v_used bigint;
begin
  if new.task_id is null then
    raise exception 'A payment request must reference a task';
  end if;
  if new.invoice_path is null then
    raise exception 'An invoice is required to request payment';
  end if;
  select assignee_id, coalesce(awarded_cost_cents, 0), plan_approved_at
    into v_assignee, v_awarded, v_approved
    from public.tasks where id = new.task_id;
  if v_assignee is null or v_assignee is distinct from new.contractor_id then
    raise exception 'Only the task assignee can request payment for it';
  end if;
  if v_approved is null or v_awarded <= 0 then
    raise exception 'This task has no approved plan amount to invoice';
  end if;
  select coalesce(sum(amount_cents), 0) into v_used
    from public.contractor_payment_requests
    where task_id = new.task_id and contractor_id = new.contractor_id and status <> 'rejected';
  if v_used + new.amount_cents > v_awarded then
    raise exception 'Amount exceeds what is still claimable on this task';
  end if;
  return new;
end;
$function$;

drop trigger if exists on_payment_request_insert on public.contractor_payment_requests;
create trigger on_payment_request_insert
  before insert on public.contractor_payment_requests
  for each row execute function public.enforce_payment_request_insert();
