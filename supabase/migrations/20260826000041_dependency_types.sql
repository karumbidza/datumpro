-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — dependency relationship types (FS / SS / FF / SF)
--
-- task_dependencies were finish-to-start only. This adds the four standard
-- relationship types so the programme can express start-to-start ("start
-- snagging once painting starts"), finish-to-finish, and start-to-finish links
-- alongside the default finish-to-start.
--
--   fs — successor can't START until predecessor FINISHES (+lag). The default.
--   ss — successor can't START until predecessor STARTS (+lag).
--   ff — successor can't FINISH until predecessor FINISHES (+lag).
--   sf — successor can't FINISH until predecessor STARTS (+lag).
--
-- Existing rows keep finish-to-start semantics via the default.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.task_dependencies
  add column if not exists type text not null default 'fs'
  check (type in ('fs', 'ss', 'ff', 'sf'));

-- The "can't start until predecessors are done" gate is a finish-to-start rule:
-- a start-to-start / finish-to-finish / start-to-finish predecessor should not
-- block a successor from starting. Restrict the gate to finish-to-start links.
create or replace function public.enforce_start_no_open_predecessor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    if exists (
      select 1
      from public.task_dependencies d
      join public.tasks p on p.id = d.predecessor_id
      where d.successor_id = new.id and d.type = 'fs' and p.status <> 'done'
    ) then
      raise exception 'This task is blocked: a predecessor task must be completed first';
    end if;
  end if;
  return new;
end $$;
