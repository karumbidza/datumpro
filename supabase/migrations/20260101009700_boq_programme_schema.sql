-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ programme, part 1: schema
-- (spec 2026-08-25-boq-programme-design)
--
-- boq_items.duration_days      Office estimate of working days per line — the
--                              SLA fallback when work is assigned without a tender.
-- boq_bid_items.duration_days  Bidder's proposed working days per line, sealed
--                              with the rates.
-- boq_section_deps             "This section starts after that one" links, defined
--                              on the bill so bidders see the sequence and
--                              generation copies them onto task_dependencies.
-- tasks.agreed_duration_days   The task's SLA duration (sum of its lines' days;
--                              budget at generation, winner's at award).
-- Guard trigger                Bill-derived plan lines are fixed scope: assignees
--                              may tick/schedule them but not delete or reprice.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_items add column duration_days int
  check (duration_days is null or duration_days between 0 and 3650);
alter table public.boq_bid_items add column duration_days int
  check (duration_days is null or duration_days between 0 and 3650);
alter table public.tasks add column agreed_duration_days int;

-- ── Section dependencies ─────────────────────────────────────────────────────
create table public.boq_section_deps (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  section_id    uuid not null,
  depends_on_id uuid not null,
  created_at    timestamptz not null default now(),
  primary key (section_id, depends_on_id),
  check (section_id <> depends_on_id),
  foreign key (section_id, org_id)    references public.boq_sections (id, org_id) on delete cascade,
  foreign key (depends_on_id, org_id) references public.boq_sections (id, org_id) on delete cascade
);
create index boq_section_deps_depends_idx on public.boq_section_deps (depends_on_id);

alter table public.boq_section_deps enable row level security;
create policy boq_section_deps_select on public.boq_section_deps for select
  using ((select public.is_org_staff(org_id)));
create policy boq_section_deps_write on public.boq_section_deps for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

-- Same-bill + acyclic validation. A link may only join sections of one bill, and
-- adding it must not close a loop (walk the predecessor chain from depends_on).
create or replace function public.guard_boq_section_dep()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_boq_a uuid; v_boq_b uuid; v_cycle boolean;
begin
  select boq_id into v_boq_a from public.boq_sections where id = new.section_id;
  select boq_id into v_boq_b from public.boq_sections where id = new.depends_on_id;
  if v_boq_a is null or v_boq_b is null or v_boq_a <> v_boq_b then
    raise exception 'sections must belong to the same bill';
  end if;
  with recursive chain as (
    select d.depends_on_id from public.boq_section_deps d where d.section_id = new.depends_on_id
    union
    select d.depends_on_id from public.boq_section_deps d join chain c on d.section_id = c.depends_on_id
  )
  select exists (select 1 from chain where depends_on_id = new.section_id) into v_cycle;
  if v_cycle then
    raise exception 'that link would create a dependency loop';
  end if;
  return new;
end $$;
create trigger boq_section_deps_guard
  before insert or update on public.boq_section_deps
  for each row execute function public.guard_boq_section_dep();

-- ── Bill-line integrity on plans ─────────────────────────────────────────────
-- Assignees work bill lines (tick done, set dates) but never remove or reprice
-- them — scope changes go through variations. Managers (org admin / project PM)
-- and the SECURITY DEFINER award/reprice paths (manager callers) are unaffected.
create or replace function public.guard_boq_subtask_lines()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_proj uuid; v_manager boolean;
begin
  if old.boq_item_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select t.org_id, t.project_id into v_org, v_proj from public.tasks t where t.id = old.task_id;
  v_manager := coalesce(public.can_manage_project(v_proj, v_org), false);
  if v_manager then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'bill lines cannot be removed from the plan — raise a variation instead';
  end if;
  if new.title is distinct from old.title
     or new.cost_cents is distinct from old.cost_cents
     or new.est_qty is distinct from old.est_qty
     or new.est_unit is distinct from old.est_unit
     or new.boq_item_id is distinct from old.boq_item_id then
    raise exception 'bill lines are fixed scope — only progress and dates can change';
  end if;
  return new;
end $$;
create trigger task_subtasks_guard_boq_lines
  before update or delete on public.task_subtasks
  for each row execute function public.guard_boq_subtask_lines();
