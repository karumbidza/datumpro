-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — nested BOQ sections (parent topics & sub-topics)
--
-- A section can now be a sub-topic of another section, to any depth: topic →
-- sub-topic → … . Items remain the priced leaves under whichever section holds
-- them, so totals still roll up from the leaves and never double-count.
--
-- parent_id is a tenant-consistent self-reference (composite (parent_id, org_id)
-- → (id, org_id)); null means a top-level section. Deleting a section cascades to
-- its sub-sections (and their items) exactly like the bill → section cascade.
-- Existing rows keep parent_id = null (all currently top-level) — no backfill.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_sections
  add column parent_id uuid,
  add constraint boq_sections_parent_fk
    foreign key (parent_id, org_id) references public.boq_sections (id, org_id) on delete cascade;

create index boq_sections_parent_idx on public.boq_sections (parent_id);
