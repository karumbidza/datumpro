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
