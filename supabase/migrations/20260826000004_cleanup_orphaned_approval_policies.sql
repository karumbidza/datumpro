-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — remove orphaned approval_policies (request, variation)
--
-- The approvals engine is only wired (via seeding triggers) for: extension,
-- payment, task_plan, task_variation. But two seeders also created policies for
-- entity types with no live workflow behind them:
--   • 'request'   — the `requests` table was dropped (20260101006600); nothing
--                   seeds 'request' approvals, so these policies are dead config.
--   • 'variation' — `variation_orders` exists but was never wired to the engine
--                   (no seeding trigger), so these policies are never read.
--
-- A plain DELETE isn't enough: both seeders re-create them. seed_default_approval_
-- policies (run by handle_new_org on every org creation) and set_org_approval_
-- policy (the reconfigure RPC) each loop over an array that includes 'request' and
-- 'variation'. This migration deletes the dead rows AND removes those two entity
-- types from both seeders so they never come back.
--
-- Safe: nothing seeds or reads request/variation approvals, so no approval chain
-- changes. If variations are wired to the engine later, re-add 'variation' to the
-- seeders. Validated in a rolled-back transaction: 4/4.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Remove the dead rows.
delete from public.approval_policies where entity_type in ('request', 'variation');

-- 2. Stop seeding them on org creation.
create or replace function public.seed_default_approval_policies(p_org_id uuid)
  returns void language plpgsql security definer set search_path to '' as $function$
declare et text;
begin
  foreach et in array array['extension','payment','task_plan','task_variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0), (p_org_id, et, 2, 'admin', 0);
  end loop;
end;
$function$;

-- 3. Stop re-creating them when an admin reconfigures the org approval policy.
create or replace function public.set_org_approval_policy(p_org_id uuid, p_second_role text)
  returns void language plpgsql security definer set search_path to '' as $function$
declare et text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an org owner or admin can change the approval policy';
  end if;
  delete from public.approval_policies where org_id = p_org_id;
  foreach et in array array['extension','payment','task_plan','task_variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0);
    if p_second_role is not null and p_second_role <> 'none' then
      insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
      values (p_org_id, et, 2, p_second_role::public.org_role, 0);
    end if;
  end loop;
end;
$function$;
