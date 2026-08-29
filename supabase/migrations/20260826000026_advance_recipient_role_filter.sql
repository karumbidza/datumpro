-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — an advance may only be issued to an ACTIVE contractor/contributor
--
-- issue_contractor_advance (20260826000025) checked only that the recipient was
-- *some* row in project_members — so a crafted call could record an advance
-- against a viewer/client or a disabled member. Cash effect was contained (an
-- advance is only ever recouped from that same contractor_id's own claims), but
-- it's a stray-row hygiene gap. Tighten the membership check to an active
-- contractor/contributor, matching the recipients the UI actually offers. Body is
-- identical to 20260826000025 apart from that one predicate; cancel is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.issue_contractor_advance(
  p_project uuid, p_contractor uuid, p_amount bigint, p_reference text, p_note text)
  returns uuid language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'an advance amount is required'; end if;
  select org_id into v_org from public.projects where id = p_project;
  if v_org is null then raise exception 'project not found'; end if;
  if not (public.is_org_staff(v_org)
          or coalesce(public.project_role(p_project) = 'pm', false)
          or coalesce(public.org_role(v_org) = 'finance', false)) then
    raise exception 'not authorised to issue an advance';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = p_contractor
      and status = 'active' and role in ('contractor', 'contributor')
  ) then
    raise exception 'the advance recipient must be an active contractor on this project';
  end if;

  insert into public.contractor_advances (org_id, project_id, contractor_id, amount_cents, reference, note, created_by)
  values (v_org, p_project, p_contractor, p_amount, nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), uid)
  returning id into v_id;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_org, uid, 'contractor_advance', v_id, 'advance.issued', null,
          jsonb_build_object('project_id', p_project, 'contractor_id', p_contractor, 'amount_cents', p_amount));
  return v_id;
end;
$function$;
revoke all on function public.issue_contractor_advance(uuid, uuid, bigint, text, text) from public;
grant execute on function public.issue_contractor_advance(uuid, uuid, bigint, text, text) to authenticated;
