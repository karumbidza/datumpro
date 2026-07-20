-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task acceptance → costed plan → approval → baseline + variations
--
-- The accept/decline flow already exists. This adds the commercial half:
--   • a subtask now carries a cost + a duration (hours|days) + a start date, so a
--     contractor's accepted plan IS a priced quote (the PDF "Plan + Cost" table);
--   • a task carries the plan lifecycle (submitted → approved) and the awarded
--     cost rolled up from the priced subtasks;
--   • the plan itself, and any subtask raised AFTER the baseline is locked (a
--     "variation"), run through the existing entity-agnostic PM→Admin approval
--     chain — two new entity types (`task_plan`, `task_variation`), nothing new.
--
-- Additive + back-compatible: existing subtasks default to a zero-cost baseline
-- item (is_variation = false), so today's tasks keep working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Subtask = a priced, timed line of the plan (the PDF table columns).
alter table public.task_subtasks
  add column cost_cents      bigint  not null default 0,
  add column est_qty         numeric,
  add column est_unit        text,
  add column is_variation    boolean not null default false,
  add column variation_status text,
  add constraint task_subtasks_est_unit_chk
    check (est_unit is null or est_unit in ('hours', 'days')),
  -- baseline plan items have no variation status; variations are pending→decided.
  add constraint task_subtasks_variation_status_chk
    check (variation_status is null or variation_status in ('pending', 'approved', 'rejected'));

-- 2. Task plan lifecycle + the awarded (contracted) cost.
--    plan_submitted_at → the contractor sent the priced plan for approval
--    plan_approved_at  → fully approved; baseline locked; work may start
--    awarded_cost_cents→ Σ of counted subtasks at/after approval (null = not yet)
alter table public.tasks
  add column plan_submitted_at  timestamptz,
  add column plan_approved_at   timestamptz,
  add column awarded_cost_cents bigint;

-- 3. Two new approvable entity types on the PM→Admin two-step, for existing orgs
--    (matches the seed in 20260101004300; new orgs fall back to a single Admin
--    step exactly like every other entity type does today).
insert into public.approval_policies (org_id, entity_type, request_type, min_amount_cents, approver_role, step_order)
select o.id, v.et, null, 0, v.role::public.org_role, v.step
from public.organizations o
cross join (values
  ('task_plan',      'pm', 1), ('task_plan',      'admin', 2),
  ('task_variation', 'pm', 1), ('task_variation', 'admin', 2)
) as v(et, role, step);

-- 4. Owning-project resolver gains the two new types (drives approvals_select RLS
--    so the task's project members can see the chain).
create or replace function public.approval_project(p_entity_type text, p_entity_id uuid)
  returns uuid language sql stable security definer set search_path to ''
as $function$
  select case p_entity_type
    when 'request'        then (select project_id from public.requests where id = p_entity_id)
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

-- 5. Segregation of duties: the contractor who owns the plan / raised the
--    variation can't approve it.
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

-- 6. Finalizer gains the two new effects. All prior branches are byte-for-byte
--    the 20260101004400 version; only task_plan + task_variation are added.
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
      update public.contractor_payment_requests set status = 'rejected', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    elsif pend = 0 then
      update public.contractor_payment_requests set status = 'approved', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    end if;
  elsif et = 'task_plan' then
    if rej > 0 then
      -- Plan sent back → return the task to draft so the contractor can revise
      -- and resubmit. (submitPlan clears the stale chain before reseeding.)
      update public.tasks set plan_submitted_at = null
        where id = eid and plan_approved_at is null;
    elsif pend = 0 then
      -- Fully approved → lock the baseline and award the summed cost.
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
      -- Fold the approved variation's cost into the task's awarded total.
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

-- 7. Submit-for-review gate ignores un-actioned variations: only baseline items
--    and APPROVED variations must be ticked (a pending/rejected variation must
--    not block completing the agreed scope).
create or replace function public.enforce_submit_plan_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if exists (
      select 1 from public.task_subtasks
      where task_id = new.id and not is_done
        and (is_variation = false or variation_status = 'approved')
    ) then
      raise exception 'Complete every step in the task plan before submitting for approval';
    end if;
  end if;
  return new;
end;
$$;
