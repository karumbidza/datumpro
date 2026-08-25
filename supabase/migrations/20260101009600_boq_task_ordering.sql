-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — generated tasks keep their section order.
--
-- Both generation RPCs insert every task in one transaction, and created_at
-- defaults to now() — the TRANSACTION timestamp — so the whole batch ties and
-- the tasks list (ordered by created_at) shows "1. …", "2. …" in arbitrary
-- order. Fix: stamp each generated task with clock_timestamp(), which advances
-- per statement, so insertion order (= depth-first section order) is the sort
-- order everywhere. Backfill nudges already-generated tasks into section order
-- by adding row-number milliseconds.
-- ─────────────────────────────────────────────────────────────────────────────

-- Backfill: put existing BOQ-generated tasks into section-tree order.
with recursive numbered as (
  select s.id, s.boq_id, s.parent_id,
         row_number() over (partition by s.boq_id, s.parent_id order by s.position, s.created_at) as sib_no
  from public.boq_sections s
),
tree as (
  select n.id, n.boq_id, array[n.sib_no] as path
  from numbered n where n.parent_id is null
  union all
  select n.id, n.boq_id, t.path || n.sib_no
  from numbered n join tree t on n.parent_id = t.id
),
ordered as (
  select t.id as task_id,
         row_number() over (partition by t.project_id order by tr.boq_id, tr.path) as rn
  from public.tasks t
  join tree tr on tr.id = t.boq_section_id
)
update public.tasks tk
   set created_at = tk.created_at + (o.rn * interval '1 millisecond')
  from ordered o
 where o.task_id = tk.id;

-- generate_tasks_from_boq: stamp created_at per insert.
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

    -- clock_timestamp(): distinct per insert so created_at preserves section order.
    insert into public.tasks
      (org_id, project_id, title, boq_section_id, requires_photo_on_complete, created_at)
      values (v_org, p_project_id, v_section.sec_no || '. ' || v_section.name, v_section.id, false,
              clock_timestamp())
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

-- export_award_to_project: same stamp in GENERATE mode.
create or replace function public.export_award_to_project(
  p_tender_id uuid,
  p_project_id uuid default null,
  p_new_project_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_bidder uuid; v_existing_proj uuid; v_boq uuid;
  v_winner uuid; v_boq_name text; v_linked uuid;
  v_project uuid; v_created_new boolean := false;
  v_mode text; v_tasks_exist boolean;
  v_section record; v_line record; v_task record;
  v_task_id uuid; v_task_total bigint; v_grand_total bigint := 0;
  v_line_no int; v_line_cost bigint;
  v_task_count int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_budget_kept int := 0; v_repriced int;
begin
  select org_id, status::text, awarded_bidder_id, awarded_project_id, boq_id
    into v_org, v_status, v_bidder, v_existing_proj, v_boq
    from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_status <> 'awarded' then raise exception 'tender is not awarded'; end if;
  if v_existing_proj is not null then raise exception 'tender already exported to a project'; end if;
  if v_bidder is null then raise exception 'tender has no awarded bidder'; end if;

  select user_id into v_winner from public.boq_bidders where id = v_bidder;
  if v_winner is null then raise exception 'awarded bidder has no linked user account'; end if;

  select project_id into v_linked from public.boqs where id = v_boq;

  if v_linked is not null then
    v_project := v_linked;
  elsif p_project_id is not null then
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

  insert into public.org_members (org_id, user_id, role, member_type, status)
    values (v_org, v_winner, 'member', 'contractor', 'active')
    on conflict (org_id, user_id) do nothing;
  insert into public.project_members (org_id, project_id, user_id, role)
    values (v_org, v_project, v_winner, 'contractor')
    on conflict (project_id, user_id) do nothing;

  v_tasks_exist := v_linked is not null and exists (
    select 1 from public.tasks t
    join public.boq_sections s on s.id = t.boq_section_id
    where t.project_id = v_project and s.boq_id = v_boq
  );

  if v_tasks_exist then
    v_mode := 'repriced';
    for v_task in
      select t.id, t.title, t.assignee_id
      from public.tasks t
      join public.boq_sections s on s.id = t.boq_section_id
      where t.project_id = v_project and s.boq_id = v_boq
      order by t.created_at
    loop
      if v_task.assignee_id is not null and v_task.assignee_id <> v_winner then
        v_skipped := v_skipped || to_jsonb(v_task.title);
        continue;
      end if;

      update public.task_subtasks st
         set cost_cents = round(i.qty * bi.rate_cents)::bigint
        from public.boq_items i
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
       where st.task_id = v_task.id and st.boq_item_id = i.id
         and bi.no_bid = false and bi.rate_cents is not null;
      get diagnostics v_repriced = row_count;

      select count(*) into v_line_no from public.task_subtasks st
        where st.task_id = v_task.id and st.boq_item_id is not null;
      v_budget_kept := v_budget_kept + (v_line_no - v_repriced);

      select coalesce(sum(cost_cents), 0) into v_task_total
        from public.task_subtasks where task_id = v_task.id;
      update public.tasks
         set assignee_id = v_winner, acceptance_status = 'accepted',
             plan_approved_at = now(), awarded_cost_cents = v_task_total
       where id = v_task.id;
      v_task_count := v_task_count + 1;
      v_grand_total := v_grand_total + v_task_total;
    end loop;
    if v_task_count = 0 and jsonb_array_length(v_skipped) > 0 then
      raise exception 'all generated tasks are already assigned to someone else';
    end if;
  else
    v_mode := case when v_linked is not null then 'generated_into_linked'
                   when v_created_new then 'created' else 'existing' end;
    for v_section in
      with recursive numbered as (
        select s.id, s.name, s.parent_id,
               row_number() over (partition by s.parent_id order by s.position, s.created_at) as sib_no
        from public.boq_sections s
        where s.boq_id = v_boq
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
      if not exists (
        select 1 from public.boq_items i
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
        where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
      ) then
        continue;
      end if;

      -- clock_timestamp(): distinct per insert so created_at preserves section order.
      insert into public.tasks
        (org_id, project_id, title, assignee_id, acceptance_status, plan_approved_at,
         boq_section_id, requires_photo_on_complete, created_at)
        values (v_org, v_project, v_section.sec_no || '. ' || v_section.name, v_winner,
                'accepted', now(), v_section.id, false, clock_timestamp())
        returning id into v_task_id;
      v_task_count := v_task_count + 1;

      v_task_total := 0;
      v_line_no := 0;
      for v_line in
        select i.id, i.item_no, i.description, i.uom, i.qty, i.position, bi.rate_cents
        from public.boq_items i
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
        where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
        order by i.position
      loop
        v_line_no := v_line_no + 1;
        v_line_cost := round(v_line.qty * v_line.rate_cents)::bigint;
        insert into public.task_subtasks (org_id, task_id, title, cost_cents, boq_item_id, position)
          values (
            v_org, v_task_id,
            coalesce(nullif(trim(v_line.item_no), ''), v_section.sec_no || '.' || v_line_no)
              || ' ' || v_line.description
              || case when v_line.uom is not null and trim(v_line.uom) <> ''
                      then ' — ' || trim(to_char(v_line.qty, 'FM999999990.####')) || ' ' || v_line.uom
                      else '' end,
            v_line_cost, v_line.id, v_line_no - 1
          );
        v_task_total := v_task_total + v_line_cost;
      end loop;

      update public.tasks
        set awarded_cost_cents = v_task_total, acceptance_status = 'accepted', plan_approved_at = now()
        where id = v_task_id;
      v_grand_total := v_grand_total + v_task_total;
    end loop;
  end if;

  update public.boq_tenders set awarded_project_id = v_project, updated_at = now() where id = p_tender_id;
  update public.boqs set project_id = v_project, updated_at = now()
    where id = v_boq and project_id is null;
  if v_created_new then
    update public.projects set contract_value_cents = v_grand_total where id = v_project;
  end if;

  return jsonb_build_object(
    'project_id', v_project, 'mode', v_mode, 'tasks', v_task_count,
    'skipped_tasks', v_skipped, 'budget_kept_lines', v_budget_kept);
end $$;
