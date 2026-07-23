-- Configurable approval chain per org.
-- Chain is uniform across approvable types: step 1 = PM (fixed), step 2 =
-- configurable (admin / finance / viewer / pm) or disabled (PM approves alone).

create or replace function public.seed_default_approval_policies(p_org_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare et text;
begin
  foreach et in array array['request','extension','payment','task_plan','task_variation','variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0), (p_org_id, et, 2, 'admin', 0);
  end loop;
end;
$function$;

create or replace function public.set_org_approval_policy(p_org_id uuid, p_second_role text)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare et text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an org owner or admin can change the approval policy';
  end if;
  delete from public.approval_policies where org_id = p_org_id;
  foreach et in array array['request','extension','payment','task_plan','task_variation','variation']
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

create or replace function public.handle_new_org()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if (select auth.uid()) is not null then
    insert into public.org_members (org_id, user_id, role, member_type, status)
    values (new.id, (select auth.uid()), 'owner', 'owner', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;
  insert into public.work_calendars (org_id, name, works_sat, works_sun, saturday_hours, hours_per_day, is_default)
  values
    (new.id, 'Standard 5-day',     false, false, null, 8.0, true),
    (new.id, '5.5-day (Sat half)', true,  false, 4.5,  8.0, false),
    (new.id, '6-day',              true,  false, 8.0,  8.0, false);
  perform public.seed_default_approval_policies(new.id);
  return new;
end;
$function$;
