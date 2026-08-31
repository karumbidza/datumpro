-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — a stable, manual row order for the programme (Gantt)
--
-- The programme sorted rows by start date, so moving a bar in time re-sorted the
-- list and the bar "jumped" to a new row. Give each task a persistent
-- programme_order instead: rows keep their position when rescheduled, and only
-- change when a manager deliberately drags a bar up or down.
--
-- Backfilled by start date (then due date, then creation) so the default order is
-- earliest-on-top — exactly what it looked like before, but now stable. New tasks
-- get no order (NULL) and fall to the bottom until placed, ordered among
-- themselves by date.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists programme_order double precision;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id
      order by planned_start_date asc nulls last, due_date asc nulls last, created_at asc
    ) as rn
  from public.tasks
)
update public.tasks t
set programme_order = ranked.rn
from ranked
where ranked.id = t.id and t.programme_order is null;
