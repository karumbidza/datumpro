-- Sequential approvals: a step can't be decided while an earlier step (lower
-- step_order) on the same entity is still pending. Backs up the UI gating so a
-- later approver (e.g. Admin) can never jump ahead of the PM via a raw request.
create or replace function public.enforce_approval_order()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.decision is distinct from old.decision
     and new.decision in ('approved', 'rejected') then
    if exists (
      select 1 from public.approvals a
      where coalesce(a.entity_type, 'request') = coalesce(new.entity_type, 'request')
        and coalesce(a.entity_id, a.request_id) = coalesce(new.entity_id, new.request_id)
        and a.step_order < new.step_order
        and a.decision = 'pending'
    ) then
      raise exception 'An earlier approval step is still pending';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists approvals_enforce_order on public.approvals;
create trigger approvals_enforce_order
  before update of decision on public.approvals
  for each row execute function public.enforce_approval_order();
