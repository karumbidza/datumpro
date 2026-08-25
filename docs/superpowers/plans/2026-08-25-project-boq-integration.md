# Project ↔ BOQ Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project start with a BOQ (existing or new), gain one later via a project BOQ tab, generate unassigned budget-priced tasks from a BOQ, and let a later tender award assign + reprice those tasks — per `docs/superpowers/specs/2026-08-25-project-boq-integration-design.md`.

**Architecture:** Three nullable FK columns link the systems (`boqs.project_id`, `tasks.boq_section_id`, `task_subtasks.boq_item_id`). One new SECURITY DEFINER RPC `generate_tasks_from_boq` creates unassigned tasks at budget rates; `export_award_to_project` is rewritten to detect a linked BOQ and reprice/assign existing tasks instead of creating a project. UI: a BOQ step on `/projects/new`, a manager-only BOQ tab inside a project, and small additions to the BOQ library/builder/tender pages.

**Tech Stack:** Next.js App Router (server actions), Supabase Postgres (plpgsql RPCs, RLS), Zod shared validation, psql regression suite `supabase/tests/rls_security.sql`.

**Conventions that MUST be followed (from this codebase):**
- Every RPC guard must coalesce: `if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then raise exception 'not authorised'; end if;` — never leave a nullable scalar bare in a `not(...)` guard (see memory of the NULL-bypass audit).
- SECURITY DEFINER functions: `language plpgsql security definer set search_path = ''`, then `revoke all … from public; grant execute … to authenticated;`.
- Server actions live next to their routes, start with `'use server'`, use the local `requireOrg()` pattern, return `{ error }` objects or `redirect()`.
- Money is integer cents (`bigint`). PostgREST numerics are coerced with the `n()` helper in `lib/data/boq.ts`.
- **Migrations are applied to the live DB via `mcp__supabase__apply_migration` (snake_case name, no numeric prefix) BEFORE code that reads the new columns is pushed** (main auto-deploys via Vercel). Local migration files carry the `2026010100XXXX_` prefix for repo ordering only. Next free prefixes: `009300`, `009400`, `009500`.
- Verification of DB behavior: append assertions to `supabase/tests/rls_security.sql` (one transaction, rollback at end) and/or run a rolled-back sim via `mcp__supabase__execute_sql` (`begin; … ; rollback;`).

---

### Task 1: Migration — link columns + backfill

**Files:**
- Create: `supabase/migrations/20260101009300_project_boq_link.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project ↔ BOQ linkage (spec 2026-08-25-project-boq-integration)
--
-- boqs.project_id           A BOQ may resolve to a delivery project (null = still
--                           a standalone estimate/tender/template). No unique
--                           constraint — a project can hold several packages.
-- tasks.boq_section_id      Which section a task was generated from — the award
--                           flow uses it to find and reprice the right tasks.
-- task_subtasks.boq_item_id Line-level traceability (estimate vs bid vs actual).
--
-- FKs are tenant-consistent composites and degrade with SET NULL: unlinking or
-- deleting BOQ content never deletes real work.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boqs
  add column project_id uuid,
  add constraint boqs_project_fk
    foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null;
create index boqs_project_idx on public.boqs (project_id);

alter table public.tasks
  add column boq_section_id uuid,
  add constraint tasks_boq_section_fk
    foreign key (boq_section_id, org_id) references public.boq_sections (id, org_id) on delete set null;
create index tasks_boq_section_idx on public.tasks (boq_section_id);

alter table public.task_subtasks
  add column boq_item_id uuid,
  add constraint task_subtasks_boq_item_fk
    foreign key (boq_item_id, org_id) references public.boq_items (id, org_id) on delete set null;
create index task_subtasks_boq_item_idx on public.task_subtasks (boq_item_id);

-- Backfill: tenders already exported to a delivery project link their BOQ to it.
-- First award wins if a BOQ was somehow tendered twice.
update public.boqs b
   set project_id = t.awarded_project_id
  from (
    select distinct on (boq_id) boq_id, awarded_project_id
      from public.boq_tenders
     where awarded_project_id is not null
     order by boq_id, created_at
  ) t
 where b.id = t.boq_id and b.project_id is null;
```

- [ ] **Step 2: Verify the SQL against the live schema without committing data** — run via `mcp__supabase__execute_sql`:

```sql
begin;
-- paste the whole migration body here --
select count(*) as linked_boqs from public.boqs where project_id is not null;
rollback;
```
Expected: no errors; `linked_boqs` ≥ 0 (equals the number of already-exported tenders' BOQs).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101009300_project_boq_link.sql
git commit -m "feat(boq): schema — project link + task/subtask traceability columns"
```

*(Do NOT apply to live yet — apply all three migrations together in Task 9.)*

---

### Task 2: RPC `generate_tasks_from_boq`

**Files:**
- Create: `supabase/migrations/20260101009400_generate_tasks_from_boq.sql`
- Modify: `supabase/tests/rls_security.sql` (append a new section before the final `rollback;`)

- [ ] **Step 1: Write the RPC migration**

Nested sections are numbered depth-first with per-level counters (1, 1.1, 1.2, 2 …). Window functions are not allowed in the recursive arm of a CTE, so sibling numbers are computed in a plain CTE first. Only sections that DIRECTLY hold ≥1 item become tasks. Subtask titles prefer the imported `item_no` over positional numbering.

```sql
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
```

Note: tasks are inserted WITHOUT `assignee_id` — `acceptance_status` stays at its column default and the `set_task_pending_on_assign` trigger handles pending state when a PM later assigns.

- [ ] **Step 2: Append regression tests** to `supabase/tests/rls_security.sql`, immediately before the final `rollback;`. New fixtures use the `a4…` id range (BOQ A `a333…` is consumed by the Piece-3 export test). Nested section + `item_no` fixture exercises numbering:

```sql
-- ── Project↔BOQ: generate_tasks_from_boq — guards, numbering, budget pricing ──
reset role;
reset request.jwt.claims;
insert into public.boqs (id, org_id, name) values
  ('a4330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','BOQ Gen');
insert into public.boq_sections (id, org_id, boq_id, name, position) values
  ('a4340000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Substructure', 0);
insert into public.boq_sections (id, org_id, boq_id, name, position, parent_id) values
  ('a4341000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Groundworks', 0,
   'a4340000-0000-0000-0000-000000000000');
insert into public.boq_items (id, org_id, section_id, description, uom, qty, budget_rate_cents, item_no) values
  ('a4350000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4341000-0000-0000-0000-000000000000','Excavate','m³',10,250,'1.6'),
  ('a4351000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4341000-0000-0000-0000-000000000000','Backfill','m³',4,100,null);
insert into public.projects (id, org_id, name) values
  ('a4220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','Gen Project');

set role authenticated;
-- Outsider (org B) blocked.
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000');
  raise exception 'FAIL: gen: outsider generated tasks';
exception when others then
  if position('not authorised' in SQLERRM) > 0 then raise notice 'PASS: gen: outsider blocked.';
  else raise; end if;
end $$;

-- Staff generates: 1 task (only the sub-section holds items), numbered depth-first,
-- unassigned, subtasks priced at budget with item_no preferred, BOQ linked.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v jsonb;
begin
  select public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000') into v;
  perform pg_temp.ok((v->>'tasks')::int = 1 and (v->>'subtasks')::int = 2, 'gen: 1 task / 2 subtasks created');
  perform pg_temp.ok((v->>'total_cents')::bigint = 2900, 'gen: total = 10×250 + 4×100');
  perform pg_temp.ok(
    exists (select 1 from public.tasks
            where project_id = 'a4220000-0000-0000-0000-000000000000'
              and title = '1.1. Groundworks' and assignee_id is null
              and boq_section_id = 'a4341000-0000-0000-0000-000000000000'),
    'gen: task titled from depth-first numbering, unassigned, traced to section');
  perform pg_temp.ok(
    exists (select 1 from public.task_subtasks
            where boq_item_id = 'a4350000-0000-0000-0000-000000000000'
              and title like '1.6 Excavate%' and cost_cents = 2500),
    'gen: subtask keeps imported item_no + budget pricing');
  perform pg_temp.ok(
    (select project_id from public.boqs where id = 'a4330000-0000-0000-0000-000000000000')
      = 'a4220000-0000-0000-0000-000000000000',
    'gen: BOQ linked to the project');
end $$;

-- Second generate is blocked (idempotent).
do $$
begin
  perform public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000');
  raise exception 'FAIL: gen: double generate not blocked';
exception when others then
  if position('already generated' in SQLERRM) > 0 then raise notice 'PASS: gen: double generate blocked.';
  else raise; end if;
end $$;
reset role;
reset request.jwt.claims;
```

- [ ] **Step 3: Run the sim** — via `mcp__supabase__execute_sql`, one rolled-back block: `begin;` + Task 1 migration body + Task 2 RPC body + the fixture/assertion SQL above (strip the `pg_temp.ok` helper calls into plain `do` blocks OR create the helper first — copy `pg_temp.ok` definition from the top of `rls_security.sql`) + `rollback;`.
Expected: every assertion raises `PASS: …` notices, no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101009400_generate_tasks_from_boq.sql supabase/tests/rls_security.sql
git commit -m "feat(boq): generate_tasks_from_boq RPC — unassigned budget-priced tasks + tests"
```

---

### Task 3: Rewrite `export_award_to_project` — linked-BOQ modes + jsonb result

**Files:**
- Create: `supabase/migrations/20260101009500_export_award_reprice.sql`
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` (`startDelivery`, ~line 222)
- Modify: `supabase/tests/rls_security.sql` (Piece-3 assertions use the uuid return — update to jsonb; append reprice tests)

- [ ] **Step 1: Write the migration.** The return type changes (uuid → jsonb) so the old function must be dropped. Three modes: `created`/`existing` (standalone BOQ — today's behavior, now also linking `boqs.project_id` and stamping `boq_section_id`/`boq_item_id`/`item_no` titles), `generated_into_linked` (linked, no tasks yet), `repriced` (linked, tasks exist → assign winner + reprice at bid rates; skip and report tasks a PM already assigned to someone else).

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — export_award_to_project v2 (project↔BOQ integration).
--
-- The award bridge now understands a BOQ that is already linked to a project:
--   • linked + tasks generated  → assign winner to those tasks and REPRICE the
--     subtasks from budget rates to the winner's bid rates. Tasks a PM already
--     assigned to someone else are skipped and reported, never silently
--     reassigned. Subtasks whose line the winner no-bid keep budget pricing
--     (reported as budget_kept_lines).
--   • linked + no tasks         → generate tasks assigned to the winner at bid
--     rates into the linked project (no project picker).
--   • standalone                → previous behavior (new/existing project), and
--     the BOQ is now linked to the delivery project too.
-- Return type is now jsonb: { project_id, mode, tasks, skipped_tasks[],
-- budget_kept_lines } — callers need the skip report. Old uuid signature dropped.
-- Generated tasks/subtasks now carry boq_section_id / boq_item_id and prefer the
-- imported item_no in titles, matching generate_tasks_from_boq.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.export_award_to_project(uuid, uuid, text);

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

  -- Target project: a linked BOQ dictates it; otherwise existing (validated) or new.
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

  -- Onboard the winner (idempotent).
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
    -- ── REPRICE mode: assign the winner to the generated tasks, bid rates in. ──
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
    -- ── GENERATE mode: build winner-assigned tasks at bid rates. ──
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

      insert into public.tasks
        (org_id, project_id, title, assignee_id, acceptance_status, plan_approved_at,
         boq_section_id, requires_photo_on_complete)
        values (v_org, v_project, v_section.sec_no || '. ' || v_section.name, v_winner,
                'accepted', now(), v_section.id, false)
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
revoke all on function public.export_award_to_project(uuid, uuid, text) from public;
grant execute on function public.export_award_to_project(uuid, uuid, text) to authenticated;
```

- [ ] **Step 2: Update the caller** in `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` — in `startDelivery`, replace:

```ts
  const { data: newProjectId, error } = await supabase.rpc('export_award_to_project', {
    p_tender_id: tenderId,
    p_project_id: mode === 'existing' && projectId ? projectId : null,
    p_new_project_name: mode === 'new' ? projectName : null,
  });
  if (error) throw new Error(error.message);
  const projId = newProjectId as unknown as string;
```

with:

```ts
  const { data: result, error } = await supabase.rpc('export_award_to_project', {
    p_tender_id: tenderId,
    p_project_id: mode === 'existing' && projectId ? projectId : null,
    p_new_project_name: mode === 'new' ? projectName : null,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { project_id: string; mode: string; skipped_tasks: string[] };
  const projId = res.project_id;
```

(`mode` stays `'new'` from the linked-BOQ confirm button — the RPC ignores both params when the BOQ is linked.)

- [ ] **Step 3: Update the existing Piece-3 assertions** in `supabase/tests/rls_security.sql` (~line 239): the export now returns jsonb. Replace

```sql
declare v_proj uuid;
begin
  select public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Delivery A') into v_proj;
```

with

```sql
declare v_proj uuid;
begin
  select (public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Delivery A')->>'project_id')::uuid
    into v_proj;
```

and add one assertion inside that block:

```sql
  perform pg_temp.ok(
    (select project_id from public.boqs where id = 'a3330000-0000-0000-0000-000000000000') = v_proj,
    'bridge: standalone BOQ linked to the delivery project on export');
```

- [ ] **Step 4: Append reprice-mode tests** before the final `rollback;` (after the Task-2 gen tests — they reuse the `a43…`/`a422…` fixtures, which by then hold generated unassigned tasks). Fixture: tender + winner bid on BOQ Gen; then export → reprice:

```sql
-- ── Project↔BOQ: award repricing of pre-generated tasks ───────────────────────
reset role; reset request.jwt.claims;
insert into public.boq_tenders (id, org_id, boq_id, title, status, unsealed_at, awarded_bidder_id) values
  ('a4360000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Gen Tender','awarded', now(), 'a4370000-0000-0000-0000-000000000000');
insert into public.boq_bidders (id, org_id, tender_id, company_name, contact_email, invite_token, user_id, status, submitted_at) values
  ('a4370000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4360000-0000-0000-0000-000000000000','Winner A Ltd','contractor-a@test.dev','tok-a437','a0000000-0000-0000-0000-0000000000a2','submitted', now());
-- Winner prices Excavate (400/unit); no-bids Backfill (stays at budget).
insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid) values
  ('a1110000-0000-0000-0000-000000000000','a4370000-0000-0000-0000-000000000000','a4350000-0000-0000-0000-000000000000',400,false),
  ('a1110000-0000-0000-0000-000000000000','a4370000-0000-0000-0000-000000000000','a4351000-0000-0000-0000-000000000000',null,true);

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v jsonb;
begin
  select public.export_award_to_project('a4360000-0000-0000-0000-000000000000', null, null) into v;
  perform pg_temp.ok(v->>'mode' = 'repriced', 'reprice: linked BOQ with tasks takes reprice mode');
  perform pg_temp.ok((v->>'project_id')::uuid = 'a4220000-0000-0000-0000-000000000000',
    'reprice: no new project — the linked project is used');
  perform pg_temp.ok((v->>'budget_kept_lines')::int = 1, 'reprice: no-bid line kept at budget, reported');
  perform pg_temp.ok(
    (select cost_cents from public.task_subtasks where boq_item_id = 'a4350000-0000-0000-0000-000000000000') = 4000,
    'reprice: priced line moved to bid rate (10×400)');
  perform pg_temp.ok(
    (select cost_cents from public.task_subtasks where boq_item_id = 'a4351000-0000-0000-0000-000000000000') = 400,
    'reprice: no-bid line still at budget (4×100)');
  perform pg_temp.ok(
    exists (select 1 from public.tasks
            where project_id = 'a4220000-0000-0000-0000-000000000000'
              and boq_section_id = 'a4341000-0000-0000-0000-000000000000'
              and assignee_id = 'a0000000-0000-0000-0000-0000000000a2'
              and acceptance_status = 'accepted'
              and awarded_cost_cents = 4400),
    'reprice: task assigned to winner, accepted, cost locked to subtask sum');
end $$;
reset role; reset request.jwt.claims;
```

- [ ] **Step 5: Run the full sim** via `mcp__supabase__execute_sql`: `begin;` + all three migration bodies (Tasks 1–3) + the new/updated test SQL (with `pg_temp.ok` helper defined first) + `rollback;`. Expected: all `PASS` notices, no errors. Note the double-generate test message must match the RPC ('tasks already generated from this BOQ' contains 'already generated').

- [ ] **Step 6: Typecheck** — `cd apps/web && npm run typecheck`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260101009500_export_award_reprice.sql \
        "apps/web/app/(app)/boq/[boqId]/tender/actions.ts" supabase/tests/rls_security.sql
git commit -m "feat(boq): export_award_to_project v2 — linked-BOQ reprice/generate modes, jsonb result"
```

---

### Task 4: Data layer — link-aware BOQ queries

**Files:**
- Modify: `apps/web/lib/data/boq.ts`

- [ ] **Step 1: Extend `BoqListRow` + `listBoqs`** — add `projectId`/`projectName`. Change the select to embed the project name through the new FK and map it:

```ts
export interface BoqListRow {
  id: string;
  name: string;
  clientName: string | null;
  industry: string | null;
  status: string;
  currency: string;
  boqDate: string | null;
  updatedAt: string;
  itemCount: number;
  totalCents: number;
  projectId: string | null;
  projectName: string | null;
}
```

In the query select string add `project_id, projects(name)`; in `Row` add `project_id: string | null; projects: { name: string } | null;` and in the return map add:

```ts
      projectId: r.project_id,
      projectName: r.projects?.name ?? null,
```

- [ ] **Step 2: Extend `BoqDetail` + `getBoqDetail`** the same way — add `projectId: string | null; projectName: string | null;` to the interface, `project_id, projects(name)` to the select, and map them in the returned object.

- [ ] **Step 3: Add two new functions** at the end of the file:

```ts
export interface UnlinkedBoqOption {
  id: string;
  name: string;
  status: string;
  itemCount: number;
  totalCents: number;
  currency: string;
}

/** Bills that can be attached to a project: not templates, not already linked.
 *  Any status — a draft can be attached and generated from whatever lines exist. */
export async function listUnlinkedBoqs(orgId: string): Promise<UnlinkedBoqOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select('id, name, status, currency, boq_sections(boq_items(amount_cents))')
    .eq('org_id', orgId)
    .eq('is_template', false)
    .is('project_id', null)
    .order('updated_at', { ascending: false });

  type Row = {
    id: string;
    name: string;
    status: string;
    currency: string;
    boq_sections: { boq_items: { amount_cents: number | string | null }[] | null }[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const items = (r.boq_sections ?? []).flatMap((s) => s.boq_items ?? []);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      currency: r.currency,
      itemCount: items.length,
      totalCents: items.reduce((a, it) => a + n(it.amount_cents), 0),
    };
  });
}

export interface ProjectBoqSummary {
  id: string;
  name: string;
  status: string;
  currency: string;
  updatedAt: string;
  sectionCount: number;
  itemCount: number;
  totalCents: number;
  tasksGenerated: boolean;
  generatedAt: string | null;
  changedSinceGeneration: boolean;
  tenderStatus: string | null;
}

/** The BOQ attached to a project (first by created_at when several), with the
 *  generation + drift state the project BOQ tab renders. Null when unlinked. */
export async function getProjectBoq(orgId: string, projectId: string): Promise<ProjectBoqSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, status, currency, updated_at, ' +
        'boq_sections(id, boq_items(amount_cents)), boq_tenders(status, created_at)',
    )
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  type Row = {
    id: string;
    name: string;
    status: string;
    currency: string;
    updated_at: string;
    boq_sections: { id: string; boq_items: { amount_cents: number | string | null }[] | null }[] | null;
    boq_tenders: { status: string; created_at: string }[] | null;
  };
  const r = data as unknown as Row;
  const sections = r.boq_sections ?? [];
  const items = sections.flatMap((s) => s.boq_items ?? []);

  // Generation state: any project task pointing at one of this bill's sections.
  const sectionIds = sections.map((s) => s.id);
  let tasksGenerated = false;
  let generatedAt: string | null = null;
  if (sectionIds.length > 0) {
    const { data: t } = await supabase
      .from('tasks')
      .select('created_at')
      .eq('project_id', projectId)
      .in('boq_section_id', sectionIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (t) {
      tasksGenerated = true;
      generatedAt = (t as { created_at: string }).created_at;
    }
  }

  const tenders = (r.boq_tenders ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    currency: r.currency,
    updatedAt: r.updated_at,
    sectionCount: sections.length,
    itemCount: items.length,
    totalCents: items.reduce((a, it) => a + n(it.amount_cents), 0),
    tasksGenerated,
    generatedAt,
    // touchBoq bumps boqs.updated_at on every section/item mutation, so this is
    // a faithful "bill changed after tasks were cut" signal.
    changedSinceGeneration: tasksGenerated && generatedAt !== null && r.updated_at > generatedAt,
    tenderStatus: tenders[0]?.status ?? null,
  };
}
```

- [ ] **Step 4: Typecheck** — `cd apps/web && npm run typecheck`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/data/boq.ts
git commit -m "feat(boq): data layer — project link on list/detail, unlinked options, project BOQ summary"
```

---

### Task 5: Project creation — validation + server action

**Files:**
- Modify: `packages/shared/src/validation/index.ts` (`createProjectSchema`, line 71)
- Modify: `apps/web/app/(app)/projects/actions.ts` (`createProject`)

- [ ] **Step 1: Extend the schema.** Add two fields to `createProjectSchema` (after `templateId`):

```ts
  boqMode: z.enum(['none', 'existing', 'create']).default('none'),
  boqId: z.string().uuid().optional().nullable(),
```

and chain a refinement onto the object (rename the raw object if needed so the exported const keeps its name):

```ts
export const createProjectSchema = z
  .object({
    /* …existing fields… */
    boqMode: z.enum(['none', 'existing', 'create']).default('none'),
    boqId: z.string().uuid().optional().nullable(),
  })
  .refine((d) => d.boqMode !== 'existing' || !!d.boqId, {
    message: 'Pick the BOQ to use for this project.',
    path: ['boqId'],
  });
```

- [ ] **Step 2: Wire the action.** In `createProject` in `apps/web/app/(app)/projects/actions.ts`:

Add to the `safeParse` input (after `templateId`):

```ts
    boqMode: String(formData.get('boqMode') ?? 'none'),
    boqId: (formData.get('boqId') as string) || undefined,
```

Then replace the final block

```ts
  revalidatePath('/projects');
  redirect(`/projects/${projectId}/setup`);
```

with:

```ts
  revalidatePath('/projects');

  // BOQ step (spec 2026-08-25): "existing" generates unassigned budget-priced
  // tasks now; "create" opens a fresh draft bill linked to the project — tasks
  // are generated later from the project BOQ tab once the bill is approved.
  // Generation failure never rolls the project back; the BOQ tab shows the
  // error with a retry.
  if (d.boqMode === 'existing' && d.boqId) {
    const { error: genErr } = await supabase.rpc('generate_tasks_from_boq', {
      p_boq_id: d.boqId,
      p_project_id: projectId,
    });
    if (genErr) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(genErr.message)}`);
    redirect(`/projects/${projectId}/setup`);
  }
  if (d.boqMode === 'create') {
    const { data: nb, error: boqErr } = await supabase
      .from('boqs')
      .insert({
        org_id: orgId,
        name: d.name,
        boq_type: 'measured',
        client_id: d.clientId,
        currency: d.currency,
        project_id: projectId,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (boqErr || !nb)
      redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(boqErr?.message ?? 'Could not create the BOQ.')}`);
    redirect(`/boq/${(nb as { id: string }).id}`);
  }
  redirect(`/projects/${projectId}/setup`);
```

- [ ] **Step 3: Typecheck** — `cd apps/web && npm run typecheck`. Expected: clean (the `/projects/[projectId]/boq` route referenced by the redirects is only a URL string — the page arrives in Task 7).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/validation/index.ts "apps/web/app/(app)/projects/actions.ts"
git commit -m "feat(projects): BOQ step in createProject — generate from existing or open a linked draft"
```

---

### Task 6: New-project form — the BOQ choice UI

**Files:**
- Modify: `apps/web/app/(app)/projects/new/page.tsx`
- Modify: `apps/web/app/(app)/projects/new/new-project-form.tsx`

- [ ] **Step 1: Load unlinked BOQs in the page.** In `page.tsx`, import `listUnlinkedBoqs` from `@/lib/data/boq`, add it to the `Promise.all`:

```ts
  const [clients, calendars, members, boqs] = await Promise.all([
    listClients(orgId),
    listWorkCalendars(orgId),
    listOrgMembers(orgId),
    listUnlinkedBoqs(orgId),
  ]);
```

and pass `boqs={boqs}` to `<NewProjectForm …>`.

- [ ] **Step 2: Add the form section.** In `new-project-form.tsx`:
  - Import the type: `import type { UnlinkedBoqOption } from '@/lib/data/boq';`
  - Add `boqs: UnlinkedBoqOption[];` to the props type and destructure it.
  - Add state next to the other controlled fields:

```ts
  const [boqMode, setBoqMode] = useState<'none' | 'existing' | 'create'>('none');
  const [boqId, setBoqId] = useState('');
```

  - Insert this block into the JSX between the *Team members* block and the *Template* block:

```tsx
      {/* Bill of Quantities — none / start from an existing bill / draft one now */}
      <div>
        <label className={labelClass}>Bill of Quantities</label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['none', 'No BOQ'],
              ['existing', 'Use existing BOQ'],
              ['create', 'Create BOQ now'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBoqMode(mode)}
              disabled={mode === 'existing' && boqs.length === 0}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                boqMode === mode
                  ? 'bg-brand-600 text-white'
                  : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input type="hidden" name="boqMode" value={boqMode} />
        {boqMode === 'existing' && (
          <div className="mt-2">
            <select name="boqId" required value={boqId} onChange={(e) => setBoqId(e.target.value)} className={inputClass}>
              <option value="">Choose a bill…</option>
              {boqs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.itemCount} items · {b.currency} {(b.totalCents / 100).toLocaleString()}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Tasks are generated from its sections at your budget rates — unassigned, ready for contractors.
            </p>
          </div>
        )}
        {boqMode === 'create' && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            A draft bill is created with this project&apos;s name, client and currency — you&apos;ll land in the
            builder. Generate tasks from the project&apos;s BOQ tab when the bill is approved.
          </p>
        )}
      </div>
```

- [ ] **Step 3: Typecheck** — `cd apps/web && npm run typecheck`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/projects/new/page.tsx" "apps/web/app/(app)/projects/new/new-project-form.tsx"
git commit -m "feat(projects): BOQ choice on the new-project form (none / existing / create)"
```

---

### Task 7: Project BOQ tab + nav item

**Files:**
- Modify: `apps/web/components/shell/nav-items.ts`
- Create: `apps/web/app/(app)/projects/[projectId]/boq/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/boq/actions.ts`
- Create: `apps/web/app/(app)/projects/[projectId]/boq/boq-tab-controls.tsx`

- [ ] **Step 1: Nav item.** In `computeNav` (project branch), after the Finance push add:

```ts
    if (manages) {
      items.push({ name: 'BOQ', href: `/projects/${id}/boq`, icon: FileText });
    }
```

(`FileText` is already imported.)

- [ ] **Step 2: Server actions** — `apps/web/app/(app)/projects/[projectId]/boq/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';

/** Signed-in user + active org, or bounce — same shape as the BOQ actions.
 *  All writes run under RLS (org admin/PM for boqs); the generate RPC guards itself. */
async function requireOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  return { supabase, userId: user.id, orgId: ctx.active.orgId };
}

/** Attach an existing unlinked bill to this project (no task generation yet). */
export async function attachBoq(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase
    .from('boqs')
    .update({ project_id: projectId })
    .eq('id', boqId)
    .is('project_id', null);
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
}

/** Create a draft bill pre-filled from the project and open the builder. */
export async function createProjectBoq(formData: FormData): Promise<void> {
  const { supabase, userId, orgId } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');

  const { data: proj } = await supabase
    .from('projects')
    .select('name, client_id, currency')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!proj) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent('Project not found.')}`);
  const p = proj as { name: string; client_id: string | null; currency: string };

  const { data: nb, error } = await supabase
    .from('boqs')
    .insert({
      org_id: orgId,
      name: p.name,
      boq_type: 'measured',
      client_id: p.client_id,
      currency: p.currency,
      project_id: projectId,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error || !nb)
    redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error?.message ?? 'Could not create the BOQ.')}`);
  redirect(`/boq/${(nb as { id: string }).id}`);
}

/** Generate unassigned budget-priced tasks from the linked bill (RPC guards +
 *  idempotency live in the database). */
export async function generateBoqTasks(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase.rpc('generate_tasks_from_boq', {
    p_boq_id: boqId,
    p_project_id: projectId,
  });
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
  revalidatePath(`/projects/${projectId}/tasks`);
  redirect(`/projects/${projectId}/tasks`);
}

/** Detach the bill. Generated tasks stay — they are real work; only the link goes. */
export async function unlinkBoq(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const projectId = String(formData.get('projectId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase
    .from('boqs')
    .update({ project_id: null })
    .eq('id', boqId)
    .eq('project_id', projectId);
  if (error) redirect(`/projects/${projectId}/boq?genError=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${projectId}/boq`);
}
```

- [ ] **Step 3: The page** — `apps/web/app/(app)/projects/[projectId]/boq/page.tsx`. Manager-gated like Finance (check `ctx.active.role` in owner/admin/pm or the project's PM — copy the exact gate used by `apps/web/app/(app)/projects/[projectId]/finance/page.tsx`; read that file first and mirror its access check and `PageContainer` wrapper):

```tsx
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser, getActiveContext } from '@/lib/data/org';
import { getProjectBoq, listUnlinkedBoqs } from '@/lib/data/boq';
import { PageContainer } from '@/components/shell/page-container';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BoqTabControls } from './boq-tab-controls';

export default async function ProjectBoqPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ genError?: string }>;
}) {
  const { projectId } = await params;
  const { genError } = await searchParams;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');

  // Same management gate as the Finance tab (mirror finance/page.tsx exactly).
  const canManage = ['owner', 'admin', 'pm'].includes(ctx.active.role);
  if (!canManage) notFound();

  const boq = await getProjectBoq(ctx.active.orgId, projectId);
  const unlinked = boq ? [] : await listUnlinkedBoqs(ctx.active.orgId);

  return (
    <PageContainer width="xl">
      <h1 className="text-2xl font-semibold tracking-tight">Bill of Quantities</h1>

      {genError && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {genError}
        </p>
      )}

      {boq === null ? (
        <Card className="mt-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No bill is attached to this project. Attach an existing bill from the library, or draft a new
            one — its line items become the project&apos;s tasks.
          </p>
          <BoqTabControls projectId={projectId} boq={null} unlinked={unlinked} />
        </Card>
      ) : (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href={`/boq/${boq.id}`} className="text-lg font-medium text-brand-600 hover:underline dark:text-brand-500">
                {boq.name} →
              </Link>
              <Badge tone={boq.status === 'approved' ? 'green' : 'faint'}>{boq.status}</Badge>
              {boq.tenderStatus && <Badge tone="blue">tender: {boq.tenderStatus}</Badge>}
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {boq.sectionCount} sections · {boq.itemCount} items · {boq.currency}{' '}
              {(boq.totalCents / 100).toLocaleString()}
            </p>
          </div>

          {boq.changedSinceGeneration && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              The bill changed after tasks were generated. Scope changes flow through task variations —
              the generated tasks are not re-synced automatically.
            </p>
          )}

          {boq.tasksGenerated ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              Tasks were generated from this bill —{' '}
              <Link href={`/projects/${projectId}/tasks`} className="font-medium text-brand-600 hover:underline dark:text-brand-500">
                view tasks →
              </Link>
            </p>
          ) : (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              No tasks generated yet. Generating creates one task per section with budget-priced
              subtasks per line — unassigned, ready to hand to contractors.
            </p>
          )}

          <BoqTabControls projectId={projectId} boq={boq} unlinked={[]} />
        </Card>
      )}
    </PageContainer>
  );
}
```

- [ ] **Step 4: Client controls** — `apps/web/app/(app)/projects/[projectId]/boq/boq-tab-controls.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import type { ProjectBoqSummary, UnlinkedBoqOption } from '@/lib/data/boq';
import { attachBoq, createProjectBoq, generateBoqTasks, unlinkBoq } from './actions';

export function BoqTabControls({
  projectId,
  boq,
  unlinked,
}: {
  projectId: string;
  boq: ProjectBoqSummary | null;
  unlinked: UnlinkedBoqOption[];
}) {
  const [boqId, setBoqId] = useState('');

  if (boq === null) {
    return (
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {unlinked.length > 0 && (
          <form action={attachBoq} className="flex items-end gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <select name="boqId" required value={boqId} onChange={(e) => setBoqId(e.target.value)} className={inputClass}>
              <option value="">Attach existing bill…</option>
              {unlinked.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.itemCount} items
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary" disabled={!boqId}>
              Attach
            </Button>
          </form>
        )}
        <form action={createProjectBoq}>
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" size="sm">
            Create BOQ
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {!boq.tasksGenerated && (
        <form action={generateBoqTasks}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="boqId" value={boq.id} />
          <Button type="submit" size="sm">
            Generate tasks
          </Button>
        </form>
      )}
      <form action={unlinkBoq}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="boqId" value={boq.id} />
        <Button type="submit" size="sm" variant="secondary">
          Unlink
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck** — `cd apps/web && npm run typecheck`. Expected: clean. If `Badge` tones or `Card` props differ from the code above, open the components and adjust to their real APIs (they exist — see the tender page imports).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/components/shell/nav-items.ts" "apps/web/app/(app)/projects/[projectId]/boq/"
git commit -m "feat(projects): BOQ tab — attach/create/generate/unlink + drift notice + nav item"
```

---

### Task 8: Surface the link — library column, builder breadcrumb + approve banner, tender linked-delivery

**Files:**
- Modify: `apps/web/app/(app)/boq/page.tsx` (library table — read the file first)
- Modify: `apps/web/app/(app)/boq/[boqId]/page.tsx` (builder page — read the file first)
- Modify: `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` (banner — read the file first)
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/page.tsx` + `start-delivery.tsx`

- [ ] **Step 1: Library "Project" column.** In `boq/page.tsx`, the staff library table renders rows from `listBoqs` (which now returns `projectId`/`projectName`). Add a `Project` header cell after the Client column, and a matching row cell:

```tsx
{b.projectId ? (
  <Link href={`/projects/${b.projectId}`} className="text-brand-600 hover:underline dark:text-brand-500"
        onClick={(e) => e.stopPropagation()}>
    {b.projectName}
  </Link>
) : (
  <span className="text-zinc-400">—</span>
)}
```

(Match the table's existing cell classes; the rows are click-through to the bill — keep the `stopPropagation` if the row itself is a link/click handler, drop it otherwise.)

- [ ] **Step 2: Builder breadcrumb + approve banner.** `getBoqDetail` now returns `projectId`/`projectName`. In `boq/[boqId]/page.tsx`, pass them (plus a `tasksGenerated` boolean — query as in `getProjectBoq`, or import and call `getProjectBoq(orgId, detail.projectId)` when linked) down to the builder. In `boq-builder.tsx`:
  - Under the bill title, when linked render:

```tsx
<Link href={`/projects/${projectId}/boq`} className="text-xs text-brand-600 hover:underline dark:text-brand-500">
  Project: {projectName} →
</Link>
```

  - When `status === 'approved' && projectId && !tasksGenerated`, render a banner near the header:

```tsx
<div className="mt-3 flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/30">
  <p className="text-sm text-brand-700 dark:text-brand-400">
    Bill approved — generate this project&apos;s tasks from it.
  </p>
  <Link href={`/projects/${projectId}/boq`} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-500">
    Generate tasks →
  </Link>
</div>
```

(The Generate button itself lives on the project BOQ tab — one place, one action.)

- [ ] **Step 3: Tender page — linked delivery.** In `tender/page.tsx` the Delivery box currently renders `<StartDelivery tenderId boqId projects>`. `boq` here is the `getBoqDetail` result, so `boq.projectId`/`boq.projectName` are available. Pass them through:

```tsx
<StartDelivery
  tenderId={tender.id}
  boqId={boqId}
  projects={projects}
  linkedProject={boq?.projectId ? { id: boq.projectId, name: boq.projectName ?? 'project' } : null}
/>
```

In `start-delivery.tsx`, add `linkedProject?: { id: string; name: string } | null` to `Props` and, at the top of the component (before the `open` state early-return), render the linked variant instead of the picker:

```tsx
  if (linkedProject) {
    return (
      <form action={startDelivery}>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="boqId" value={boqId} />
        <input type="hidden" name="mode" value="new" />
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
          This bill belongs to <span className="font-medium">{linkedProject.name}</span>. The winner is
          assigned to its tasks and prices move to the winning bid.
        </p>
        <Button type="submit" size="sm">Assign winner to {linkedProject.name} →</Button>
      </form>
    );
  }
```

(The RPC ignores the mode/name params for a linked BOQ — Task 3.)

- [ ] **Step 4: Typecheck + build** — `cd apps/web && npm run typecheck && npm run build`. Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/boq/"
git commit -m "feat(boq): surface the project link — library column, builder breadcrumb/banner, linked delivery"
```

---

### Task 9: Ship — apply migrations to live, run suite, push

- [ ] **Step 1: Apply the three migrations to the live DB, in order,** via `mcp__supabase__apply_migration` (code on main reads the new columns, so DB first — same rule as the item_no ship):
  1. name `project_boq_link`, query = body of `20260101009300_project_boq_link.sql`
  2. name `generate_tasks_from_boq`, query = body of `20260101009400_generate_tasks_from_boq.sql`
  3. name `export_award_reprice`, query = body of `20260101009500_export_award_reprice.sql`

- [ ] **Step 2: Post-apply smoke check** via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from information_schema.columns
    where table_name in ('boqs','tasks','task_subtasks')
      and column_name in ('project_id','boq_section_id','boq_item_id')) as new_cols,
  (select count(*) from pg_proc where proname = 'generate_tasks_from_boq') as gen_fn,
  (select prorettype::regtype::text from pg_proc where proname = 'export_award_to_project') as export_returns;
```
Expected: `new_cols = 3` (plus `projects.project_id`-style collisions don't exist — verify it's exactly the three), `gen_fn = 1`, `export_returns = 'jsonb'`.

- [ ] **Step 3: Final verification** — `cd apps/web && npm run typecheck && npm run build`. Expected: clean.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Manual smoke test on live** (report results, don't skip): create a project choosing *Use existing BOQ* with a small test bill → confirm tasks appear unassigned with budget-priced subtasks; open the project BOQ tab; check the library Project column.

---

## Self-review notes (already applied)

- **Spec coverage:** §3 data model → Task 1; §4 generate RPC → Task 2; §6 award modes + reassignment guard → Task 3; §5 creation flow → Tasks 5–6; §7 nav/UI → Tasks 7–8; §9 testing → Tasks 2/3 SQL assertions + Task 9 smoke; §10 rollout order preserved. §8 edge cases: unlink keeps tasks (Task 7 `unlinkBoq`), drift notice (Task 4 `changedSinceGeneration` + Task 7 banner), delete-linked-BOQ blocked — **covered by FK behavior**: deleting a bill cascades sections→items, and `on delete set null` detaches tasks; v1 relies on the builder having no delete-bill affordance for linked bills (none exists today — `deleteSection` only). No extra work.
- **Type consistency:** `generate_tasks_from_boq(p_boq_id, p_project_id)` used identically in Tasks 2/5/7; `UnlinkedBoqOption`/`ProjectBoqSummary` defined Task 4, consumed Tasks 6/7; export return shape `{project_id, mode, skipped_tasks, budget_kept_lines}` defined Task 3 and read in its caller.
- **Known judgment calls:** double-generate error message is `'tasks already generated from this BOQ'` — tests match on `'already generated'`. The tender-page linked flow sends `mode="new"` merely to satisfy the existing hidden-input shape; the RPC ignores it when linked.
