-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — shared two-step approval engine (Stage 1: generalise the engine)
--
-- Today `approvals` + finalize_request + SoD only serve `requests`. This makes the
-- chain ENTITY-AGNOSTIC so the same PM→Admin two-step drives requests, variations,
-- extensions, and payment requests. Stage 1 is additive + back-compatible: the
-- requests flow behaves exactly as before (verified). Wiring the other three
-- entities to seed steps + apply their effects is Stage 2; the UI is Stage 3.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Polymorphic reference on approvals + policies. request_id stays for back-compat.
alter table public.approvals
  add column entity_type text not null default 'request',
  add column entity_id   uuid;
update public.approvals set entity_id = request_id where entity_id is null;
alter table public.approvals alter column request_id drop not null;
create index approvals_entity_idx on public.approvals (entity_type, entity_id);

alter table public.approval_policies
  add column entity_type text not null default 'request';
alter table public.approval_policies alter column request_type drop not null;

-- 2. Seed the default two-step policy (PM first, Admin final) for every approvable
--    type, for every existing org. min_amount 0 = always applies.
insert into public.approval_policies (org_id, entity_type, request_type, min_amount_cents, approver_role, step_order)
select o.id, v.et, null, 0, v.role::public.org_role, v.step
from public.organizations o
cross join (values
  ('request',  'pm',    1), ('request',   'admin', 2),
  ('variation','pm',    1), ('variation', 'admin', 2),
  ('extension','pm',    1), ('extension', 'admin', 2),
  ('payment',  'pm',    1), ('payment',   'admin', 2)
) as v(et, role, step);

-- 3. Generalised finalizer — dispatches to the right entity by type. The 'request'
--    branch is byte-for-byte the old behaviour; the others stay dormant until
--    Stage 2 wires those entities to create approval steps.
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

-- Re-point the existing finalize trigger at the generalised function.
drop trigger if exists approvals_finalize on public.approvals;
create trigger approvals_finalize
  after insert or update on public.approvals
  for each row execute function public.finalize_approval();

-- 4. Generalised segregation-of-duties: the requester of ANY entity can't approve
--    their own item.
create or replace function public.enforce_approval_sod()
  returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_requester uuid; et text; eid uuid;
begin
  if new.approver_id is null then return new; end if;
  et := coalesce(new.entity_type, 'request');
  eid := coalesce(new.entity_id, new.request_id);
  if et = 'request' then
    select raised_by into v_requester from public.requests where id = eid;
  elsif et = 'variation' then
    select created_by into v_requester from public.variation_orders where id = eid;
  elsif et = 'extension' then
    select requested_by into v_requester from public.task_extension_requests where id = eid;
  elsif et = 'payment' then
    select contractor_id into v_requester from public.contractor_payment_requests where id = eid;
  end if;
  if v_requester is not null and v_requester = new.approver_id then
    raise exception 'segregation of duties: the requester cannot approve their own request';
  end if;
  return new;
end $function$;

-- 5. Seed the ordered pending steps for an entity from its org's policy (amount
--    threshold aware). Falls back to a single Admin step if no policy exists.
create or replace function public.seed_approval_steps(
  p_entity_type text,
  p_entity_id   uuid,
  p_org_id      uuid,
  p_amount_cents bigint default 0
) returns void language plpgsql security definer set search_path to ''
as $function$
declare r record; n int := 0;
begin
  for r in
    select step_order, approver_role
    from public.approval_policies
    where org_id = p_org_id and entity_type = p_entity_type
      and coalesce(min_amount_cents, 0) <= coalesce(p_amount_cents, 0)
    order by step_order
  loop
    insert into public.approvals (org_id, entity_type, entity_id, step_order, approver_role, decision)
    values (p_org_id, p_entity_type, p_entity_id, r.step_order, r.approver_role, 'pending');
    n := n + 1;
  end loop;
  if n = 0 then
    insert into public.approvals (org_id, entity_type, entity_id, step_order, approver_role, decision)
    values (p_org_id, p_entity_type, p_entity_id, 1, 'admin', 'pending');
  end if;
end $function$;
