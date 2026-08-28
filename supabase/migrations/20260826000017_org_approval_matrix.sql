-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — configurable approval matrix.
--
-- Generalises set_org_approval_policy (uniform PM→role) to a per-entity-type
-- chain: step 1 is always PM; steps 2..N are the configured roles, applied only
-- when the entity amount meets min_amount_cents. Role-based approvers only — no
-- schema change (approval_policies already has entity_type/step_order/
-- approver_role/min_amount_cents). set_org_approval_policy is left in place.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_org_approval_matrix(p_org_id uuid, p_rows jsonb)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  et         text;
  v_row      jsonb;
  extra_role text;
  v_step     int;
  v_threshold bigint;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an org owner or admin can change the approval policy';
  end if;

  delete from public.approval_policies where org_id = p_org_id;

  -- Invariant: every entity type keeps a PM step 1 at zero threshold (covers the
  -- retired 'variation' type too, so nothing is left without a first step).
  foreach et in array array['request', 'extension', 'payment', 'task_plan', 'task_variation', 'variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0);
  end loop;

  -- Extra approver steps (2..N) per configured entity type, at the threshold.
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(value)
  loop
    et := v_row ->> 'entity_type';
    if et is null then continue; end if;
    v_threshold := coalesce((v_row ->> 'min_amount_cents')::bigint, 0);
    v_step := 2;
    for extra_role in select value from jsonb_array_elements_text(coalesce(v_row -> 'extra_roles', '[]'::jsonb)) as t(value)
    loop
      if extra_role is not null and extra_role <> 'none' and extra_role <> '' then
        insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
        values (p_org_id, et, v_step, extra_role::public.org_role, v_threshold);
        v_step := v_step + 1;
      end if;
    end loop;
  end loop;
end;
$function$;

revoke all on function public.set_org_approval_matrix(uuid, jsonb) from public;
grant execute on function public.set_org_approval_matrix(uuid, jsonb) to authenticated;
