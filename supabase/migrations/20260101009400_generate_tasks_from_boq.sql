-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — generate_tasks_from_boq: materialise a BOQ into unassigned,
-- budget-priced tasks on a project. The second entry point to the same engine
-- as export_award_to_project (which assigns the tender winner at bid rates).
--
-- One task per section that directly holds ≥1 item, numbered depth-first
-- ("1. Preliminaries", "1.2. Groundworks"); one subtask per item, cost =
-- round(qty × budget_rate_cents), titled with the imported item_no when
-- present. Tasks are UNASSIGNED — PMs assign contractors later and the
-- existing acceptance → plan → approval chain takes over.
-- Idempotent: refuses if any task on the project already points at one of this
-- bill's sections. Links boqs.project_id as a side effect.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.generate_tasks_from_boq(
  p_boq_id uuid,
  p_project_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_is_template boolean; v_linked uuid;
  v_proj_org uuid;
  v_section record; v_line record;
  v_task uuid; v_task_total bigint;
  v_line_no int; v_line_cost bigint;
  v_tasks int := 0; v_subtasks int := 0; v_grand_total bigint := 0;
begin
  select org_id, is_template, project_id into v_org, v_is_template, v_linked
    from public.boqs where id = p_boq_id;
  if v_org is null then raise exception 'BOQ not found'; end if;
  -- NB: coalesce the guard — is_org_admin()/org_role() return NULL for a
  -- non-member and `NOT NULL` never fires (see the null-bypass audit).
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_is_template then raise exception 'templates cannot be generated directly — duplicate first'; end if;

  select org_id into v_proj_org from public.projects where id = p_project_id;
  if v_proj_org is null or v_proj_org <> v_org then
    raise exception 'target project not found in this organisation';
  end if;
  if v_linked is not null and v_linked <> p_project_id then
    raise exception 'BOQ is linked to a different project';
  end if;
  if exists (
    select 1 from public.tasks t
    join public.boq_sections s on s.id = t.boq_section_id
    where t.project_id = p_project_id and s.boq_id = p_boq_id
  ) then
    raise exception 'tasks already generated from this BOQ';
  end if;

  -- Depth-first walk with per-level counters (1, 1.1, 1.2, 2 …). Window
  -- functions are not allowed in a recursive arm, so sibling numbers come from
  -- a plain CTE first.
  for v_section in
    with recursive numbered as (
      select s.id, s.name, s.parent_id,
             row_number() over (partition by s.parent_id order by s.position, s.created_at) as sib_no
      from public.boq_sections s
      where s.boq_id = p_boq_id
    ),
    tree as (
      select n.id, n.name, n.sib_no::text as sec_no, array[n.sib_no] as path
      from numbered n where n.parent_id is null
      union all
      select n.id, n.name, t.sec_no || '.' || n.sib_no, t.path || n.sib_no
      from numbered n join tree t on n.parent_id = t.id
    )
    select id, name, sec_no from tree order by path
  loop
    if not exists (select 1 from public.boq_items i where i.section_id = v_section.id) then
      continue;
    end if;

    -- Unassigned on purpose: acceptance_status stays at its default; the
    -- set_task_pending_on_assign trigger takes over when a PM assigns.
    insert into public.tasks
      (org_id, project_id, title, boq_section_id, requires_photo_on_complete)
      values (v_org, p_project_id, v_section.sec_no || '. ' || v_section.name, v_section.id, false)
      returning id into v_task;
    v_tasks := v_tasks + 1;

    v_task_total := 0;
    v_line_no := 0;
    for v_line in
      select i.id, i.item_no, i.description, i.uom, i.qty, i.budget_rate_cents
      from public.boq_items i
      where i.section_id = v_section.id
      order by i.position
    loop
      v_line_no := v_line_no + 1;
      v_line_cost := round(v_line.qty * v_line.budget_rate_cents)::bigint;
      insert into public.task_subtasks (org_id, task_id, title, cost_cents, boq_item_id, position)
        values (
          v_org, v_task,
          coalesce(nullif(trim(v_line.item_no), ''), v_section.sec_no || '.' || v_line_no)
            || ' ' || v_line.description
            || case when v_line.uom is not null and trim(v_line.uom) <> ''
                    then ' — ' || trim(to_char(v_line.qty, 'FM999999990.####')) || ' ' || v_line.uom
                    else '' end,
          v_line_cost, v_line.id, v_line_no - 1
        );
      v_task_total := v_task_total + v_line_cost;
      v_subtasks := v_subtasks + 1;
    end loop;
    v_grand_total := v_grand_total + v_task_total;
  end loop;

  if v_tasks = 0 then raise exception 'this BOQ has no priced items to generate from'; end if;

  update public.boqs set project_id = p_project_id, updated_at = now()
    where id = p_boq_id and project_id is null;

  return jsonb_build_object('tasks', v_tasks, 'subtasks', v_subtasks, 'total_cents', v_grand_total);
end $$;
revoke all on function public.generate_tasks_from_boq(uuid, uuid) from public;
grant execute on function public.generate_tasks_from_boq(uuid, uuid) to authenticated;
