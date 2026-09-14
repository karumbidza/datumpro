-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — bidders date their bill lines; the winning bid seeds the programme
--
-- Each BOQ bid line already carries a rate + a proposed duration. This lets a
-- bidder also give a START and FINISH date per line, so the winning bid hands
-- over a real programme: on award, each section's task takes the earliest start
-- and latest finish across that section's priced lines, populating the task's
-- planned window directly. The PM then edits it in the Programme (Gantt).
--
-- Two changes:
--   1. boq_bid_items gains start_date / end_date (nullable; end ≥ start).
--   2. save_bid_lines (Excel bulk path) reads/writes the two dates.
--   3. export_award_to_project seeds tasks.planned_start_date / planned_end_date /
--      due_date from the winner's per-section date roll-up (both generate and
--      reprice modes). It already sets app.workflow_ctx, so guard_task_planning_
--      update admits the planned-date writes.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_bid_items
  add column if not exists start_date date,
  add column if not exists end_date date;

do $$
begin
  alter table public.boq_bid_items
    add constraint boq_bid_items_dates_order
    check (end_date is null or start_date is null or end_date >= start_date);
exception when duplicate_object then null;
end $$;

-- ── bulk save (Excel round-trip): carry the two dates through ──
create or replace function public.save_bid_lines(p_token text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bd public.boq_bidders; t public.boq_tenders;
  uid uuid := (select auth.uid());
  v_n int; v_valid int; v_distinct int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into bd from public.boq_bidders where invite_token = p_token;
  -- Both the token AND the bound account must match — a leaked token alone is dead.
  if not found or bd.user_id is null or bd.user_id <> uid then
    raise exception 'not your bid';
  end if;
  if bd.status not in ('invited','viewing') then raise exception 'already submitted'; end if;
  select * into t from public.boq_tenders where id = bd.tender_id;
  if t.status <> 'open' or (t.close_at is not null and t.close_at < now()) then
    raise exception 'tender closed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'invalid payload'; end if;
  v_n := jsonb_array_length(p_lines);
  if v_n = 0 then raise exception 'no lines to save'; end if;
  if v_n > 2000 then raise exception 'too many lines'; end if;

  -- Rolling-hour rate limit on bulk saves.
  if bd.bulk_upload_window_start is null or bd.bulk_upload_window_start < now() - interval '1 hour' then
    update public.boq_bidders set bulk_upload_window_start = now(), bulk_upload_count = 1 where id = bd.id;
  elsif bd.bulk_upload_count >= 10 then
    raise exception 'too many uploads — try again in a while';
  else
    update public.boq_bidders set bulk_upload_count = bulk_upload_count + 1 where id = bd.id;
  end if;

  -- Every line must be a real line of THIS tender's bill with sane values;
  -- any bad line rejects the whole call (no partial writes). Dates, when given,
  -- must be a valid date and end ≥ start.
  select count(*) into v_valid
  from jsonb_array_elements(p_lines) e
  join public.boq_items i on i.id = (e->>'item_id')::uuid
  join public.boq_sections s on s.id = i.section_id and s.boq_id = t.boq_id
  where (e->>'rate_cents')::bigint >= 0
    and (nullif(e->>'duration_days','') is null
         or (e->>'duration_days')::int between 0 and 3650)
    and (nullif(e->>'start_date','') is null or nullif(e->>'end_date','') is null
         or (e->>'end_date')::date >= (e->>'start_date')::date);
  if v_valid <> v_n then
    raise exception 'the upload contains lines that are not part of this bill (or have an end date before their start)';
  end if;
  select count(distinct (e->>'item_id')::uuid) into v_distinct from jsonb_array_elements(p_lines) e;
  if v_distinct <> v_n then raise exception 'the upload contains duplicate lines'; end if;

  insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid, duration_days, start_date, end_date)
  select bd.org_id, bd.id,
         (e->>'item_id')::uuid,
         (e->>'rate_cents')::bigint,
         false,
         nullif(e->>'duration_days','')::int,
         nullif(e->>'start_date','')::date,
         nullif(e->>'end_date','')::date
  from jsonb_array_elements(p_lines) e
  on conflict (bidder_id, boq_item_id) do update
    set rate_cents = excluded.rate_cents,
        duration_days = excluded.duration_days,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        no_bid = false,
        updated_at = now();

  return jsonb_build_object('saved', v_n);
end $$;
revoke all on function public.save_bid_lines(text, jsonb) from public;
grant execute on function public.save_bid_lines(text, jsonb) to authenticated;

-- ── award → programme: seed each section-task's planned window from the winner's
--    per-line dates (min start / max finish). Body identical to
--    20260826000009 apart from the date roll-up + the planned-date writes. ──
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
  v_line_no int; v_line_cost bigint; v_task_days int;
  v_task_start date; v_task_end date;
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

  -- Vetted approval path: authorise the plan_approved_at + planned-date writes
  -- this RPC makes past guard_workflow_transition / guard_task_planning_update.
  perform set_config('app.workflow_ctx', v_org::text, true);
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

      -- SLA duration moves to the winner's proposed days (budget days as fallback).
      select sum(coalesce(bi.duration_days, i.duration_days)) into v_task_days
        from public.task_subtasks st
        join public.boq_items i on i.id = st.boq_item_id
        left join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
       where st.task_id = v_task.id;

      -- Planned window seeded from the winner's per-line dates (min start / max finish).
      select min(bi.start_date), max(bi.end_date) into v_task_start, v_task_end
        from public.task_subtasks st
        join public.boq_items i on i.id = st.boq_item_id
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
       where st.task_id = v_task.id and bi.no_bid = false and bi.rate_cents is not null;

      select coalesce(sum(cost_cents), 0) into v_task_total
        from public.task_subtasks where task_id = v_task.id;
      update public.tasks
         set assignee_id = v_winner, acceptance_status = 'accepted',
             plan_approved_at = now(), awarded_cost_cents = v_task_total,
             agreed_duration_days = coalesce(v_task_days, agreed_duration_days),
             planned_start_date = coalesce(v_task_start, planned_start_date),
             planned_end_date   = coalesce(v_task_end, planned_end_date),
             due_date           = coalesce(v_task_end, due_date)
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

      select sum(coalesce(bi.duration_days, i.duration_days)) into v_task_days
        from public.boq_items i
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
       where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null;

      -- Planned window from the winner's per-line dates across this section.
      select min(bi.start_date), max(bi.end_date) into v_task_start, v_task_end
        from public.boq_items i
        join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
       where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null;

      insert into public.tasks
        (org_id, project_id, title, assignee_id, acceptance_status, plan_approved_at,
         boq_section_id, requires_photo_on_complete, agreed_duration_days,
         planned_start_date, planned_end_date, due_date, created_at)
        values (v_org, v_project, v_section.sec_no || '. ' || v_section.name, v_winner,
                'accepted', now(), v_section.id, false, v_task_days,
                v_task_start, v_task_end, v_task_end, clock_timestamp())
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

    insert into public.task_dependencies (org_id, predecessor_id, successor_id, lag_days)
    select v_org, tp.id, ts.id, 0
    from public.boq_section_deps d
    join public.boq_sections s on s.id = d.section_id and s.boq_id = v_boq
    join public.tasks ts on ts.boq_section_id = d.section_id    and ts.project_id = v_project
    join public.tasks tp on tp.boq_section_id = d.depends_on_id and tp.project_id = v_project
    on conflict (predecessor_id, successor_id) do nothing;
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
