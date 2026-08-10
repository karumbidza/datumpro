-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — award→delivery bridge: link column + export RPC.
-- Converts an AWARDED boq_tender into a project + tasks/subtasks assigned to the
-- winning contractor, seeded from their winning bid. Idempotent via awarded_project_id.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_tenders
  add column if not exists awarded_project_id uuid,
  add constraint boq_tenders_awarded_project_fk
    foreign key (awarded_project_id, org_id)
    references public.projects (id, org_id) on delete set null;

create or replace function public.export_award_to_project(
  p_tender_id uuid,
  p_project_id uuid default null,
  p_new_project_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_bidder uuid; v_existing_proj uuid; v_boq uuid;
  v_winner uuid; v_boq_name text;
  v_project uuid; v_created_new boolean := false;
  v_section record; v_line record;
  v_task uuid; v_task_total bigint; v_grand_total bigint := 0;
  v_sec_no int := 0; v_line_no int; v_line_cost bigint;
begin
  select org_id, status::text, awarded_bidder_id, awarded_project_id, boq_id
    into v_org, v_status, v_bidder, v_existing_proj, v_boq
    from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  -- NB: BOTH is_org_admin() and org_role() return NULL for a non-member, so the raw
  -- guard evaluates to NULL and `NOT NULL` is NULL — the IF never fires and a non-member
  -- slips through. Coalesce both to a definite value.
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_status <> 'awarded' then raise exception 'tender is not awarded'; end if;
  if v_existing_proj is not null then raise exception 'tender already exported to a project'; end if;
  if v_bidder is null then raise exception 'tender has no awarded bidder'; end if;

  select user_id into v_winner from public.boq_bidders where id = v_bidder;
  if v_winner is null then raise exception 'awarded bidder has no linked user account'; end if;

  -- Project: existing (validate org) or new (named from BOQ).
  if p_project_id is not null then
    select id into v_project from public.projects where id = p_project_id and org_id = v_org;
    if v_project is null then raise exception 'target project not found in this organisation'; end if;
  else
    select name into v_boq_name from public.boqs where id = v_boq;
    insert into public.projects (org_id, name, status, created_by)
      values (v_org,
              coalesce(nullif(trim(p_new_project_name), ''), nullif(trim(v_boq_name), ''), 'Awarded works'),
              'active', (select auth.uid()))
      returning id into v_project;
    v_created_new := true;
  end if;

  -- Onboard the winner (idempotent).
  insert into public.org_members (org_id, user_id, role, member_type, status)
    values (v_org, v_winner, 'member', 'contractor', 'active')
    on conflict (org_id, user_id) do nothing;
  insert into public.project_members (org_id, project_id, user_id, role)
    values (v_org, v_project, v_winner, 'contractor')
    on conflict (project_id, user_id) do nothing;

  -- One task per section that has at least one priced line for the winner.
  for v_section in
    select s.id, s.name, s.position
    from public.boq_sections s
    where s.boq_id = v_boq
    order by s.position
  loop
    if not exists (
      select 1 from public.boq_items i
      join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
      where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
    ) then
      continue;
    end if;

    v_sec_no := v_sec_no + 1;
    insert into public.tasks
      (org_id, project_id, title, assignee_id, acceptance_status, plan_approved_at, requires_photo_on_complete)
      values (v_org, v_project, v_sec_no || '. ' || v_section.name, v_winner, 'accepted', now(), false)
      returning id into v_task;

    v_task_total := 0;
    v_line_no := 0;
    for v_line in
      select i.description, i.uom, i.qty, i.position, bi.rate_cents
      from public.boq_items i
      join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
      where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
      order by i.position
    loop
      v_line_no := v_line_no + 1;
      v_line_cost := round(v_line.qty * v_line.rate_cents)::bigint;
      insert into public.task_subtasks (org_id, task_id, title, cost_cents, position)
        values (
          v_org, v_task,
          v_sec_no || '.' || v_line_no || ' ' || v_line.description
            || case when v_line.uom is not null and trim(v_line.uom) <> ''
                    then ' — ' || trim(to_char(v_line.qty, 'FM999999990.####')) || ' ' || v_line.uom
                    else '' end,
          v_line_cost, v_line_no - 1
        );
      v_task_total := v_task_total + v_line_cost;
    end loop;

    -- Force final state (belt-and-braces vs set_task_pending_on_assign trigger) + lock cost.
    update public.tasks
      set awarded_cost_cents = v_task_total, acceptance_status = 'accepted', plan_approved_at = now()
      where id = v_task;
    v_grand_total := v_grand_total + v_task_total;
  end loop;

  update public.boq_tenders set awarded_project_id = v_project, updated_at = now() where id = p_tender_id;
  if v_created_new then
    update public.projects set contract_value_cents = v_grand_total where id = v_project;
  end if;

  return v_project;
end $$;
revoke all on function public.export_award_to_project(uuid, uuid, text) from public;
grant execute on function public.export_award_to_project(uuid, uuid, text) to authenticated;
