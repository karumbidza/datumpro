-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — new-project form details adopted from the original app
--
-- Projects gain a free-text description (surfaces on the overview header) and
-- a priority (portfolio sort key + badge; reuses the task_priority enum so the
-- two vocabularies can't drift).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects add column if not exists description text;
alter table public.projects add column if not exists priority public.task_priority not null default 'medium';
