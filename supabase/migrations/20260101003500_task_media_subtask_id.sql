-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — per-subtask photo evidence
--
-- Let a contractor attach a photo to a specific step of their plan ("here's the
-- poured slab") rather than only one photo at the end. task_media gains an
-- optional subtask_id; existing task-level media keep it null. RLS is unchanged
-- (task_media is already scoped by project).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.task_media
  add column if not exists subtask_id uuid references public.task_subtasks(id) on delete cascade;

create index if not exists task_media_subtask_idx
  on public.task_media (subtask_id) where subtask_id is not null;
