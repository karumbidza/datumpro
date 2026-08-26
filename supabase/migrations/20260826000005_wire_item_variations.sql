-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — item-level variations: PM→finance approval, reason codes, variance
--
-- When a task's plan is approved its prices are locked. Adding an unforeseen line
-- to that task (task_subtasks) is auto-flagged as a variation (set_subtask_
-- variation_flag) and routed through the approvals engine (entity_type
-- 'task_variation'); on approval finalize_approval recomputes the task's locked
-- awarded_cost_cents. This is the item-level change-order mechanism (the standalone
-- variation_orders table stays retired).
--
-- This migration improves that flow per product:
--   1. Variation approval routes PM → FINANCE (was PM → admin). Owner/admin can
--      still satisfy the finance step (approvals_decide allows it), so no deadlock;
--      finance is brought into the loop for any change to locked prices.
--   2. Variations carry a reason code + free-text reason, so the cost variance can
--      be analysed by cause.
--   3. A view exposes approved (baseline) vs actual (with approved variations) cost
--      per task — the raw material for "approved vs actual, by reason code".
--      (No baseline column needed: baseline = non-variation lines; actual =
--      awarded_cost_cents, which already grows with approved variations.)
--
-- Only task_variation gets the finance second step; extension/payment/task_plan
-- keep PM → admin. Validated in a rolled-back transaction: 7/7.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Reason code + reason on variation lines (nullable; the app collects them when
--    a variation is raised). Suggested codes: site_condition, design_change,
--    client_request, error_omission, weather, material_change, access, other.
alter table public.task_subtasks add column if not exists variation_reason_code text;
alter table public.task_subtasks add column if not exists variation_reason text;

-- 2. Seeders: task_variation → PM→finance; others → PM→admin. (Also drops the
--    orphaned request/variation entity types — consistent with the cleanup.)
create or replace function public.seed_default_approval_policies(p_org_id uuid)
  returns void language plpgsql security definer set search_path to '' as $function$
declare et text; second_role public.org_role;
begin
  foreach et in array array['extension','payment','task_plan','task_variation']
  loop
    second_role := case when et = 'task_variation' then 'finance'::public.org_role
                        else 'admin'::public.org_role end;
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0), (p_org_id, et, 2, second_role, 0);
  end loop;
end;
$function$;

-- Reconfigure keeps variations on finance even when the org picks a different
-- second approver for everything else.
create or replace function public.set_org_approval_policy(p_org_id uuid, p_second_role text)
  returns void language plpgsql security definer set search_path to '' as $function$
declare et text; second_role text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an org owner or admin can change the approval policy';
  end if;
  delete from public.approval_policies where org_id = p_org_id;
  foreach et in array array['extension','payment','task_plan','task_variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0);
    second_role := case when et = 'task_variation' then 'finance' else p_second_role end;
    if second_role is not null and second_role <> 'none' then
      insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
      values (p_org_id, et, 2, second_role::public.org_role, 0);
    end if;
  end loop;
end;
$function$;

-- 3. Migrate existing orgs' variation second step to finance.
update public.approval_policies set approver_role = 'finance'
  where entity_type = 'task_variation' and step_order = 2 and approver_role = 'admin';

-- 4. Approved (baseline) vs actual (with approved variations) cost per task.
--    security_invoker so the caller's RLS on tasks/task_subtasks applies.
create or replace view public.task_cost_variance with (security_invoker = true) as
select
  t.id         as task_id,
  t.org_id,
  t.project_id,
  t.title,
  coalesce(sum(s.cost_cents) filter (where not coalesce(s.is_variation, false)), 0)::bigint as baseline_cost_cents,
  coalesce(sum(s.cost_cents) filter (where s.is_variation and s.variation_status = 'approved'), 0)::bigint as approved_variation_cents,
  coalesce(t.awarded_cost_cents, 0)::bigint as actual_cost_cents
from public.tasks t
left join public.task_subtasks s on s.task_id = t.id
group by t.id, t.org_id, t.project_id, t.title, t.awarded_cost_cents;

grant select on public.task_cost_variance to authenticated;
