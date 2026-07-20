-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — a task can't START until its predecessors are done
--
-- Dependencies (task_dependencies) already exist and are cycle-checked, but they
-- were purely informational for scheduling — nothing stopped a successor from
-- starting early. This makes the "can't start before others complete" rule real:
-- moving a task to in_progress is rejected while any predecessor task isn't done.
--
-- This is independent of the manual `blocked` status and the plan-approval gate;
-- all three are checked on the same transition. Tendering, quoting and assigning
-- a blocked task stay allowed — only starting the work is gated.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_start_no_open_predecessor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    if exists (
      select 1
      from public.task_dependencies d
      join public.tasks p on p.id = d.predecessor_id
      where d.successor_id = new.id and p.status <> 'done'
    ) then
      raise exception 'This task is blocked: a predecessor task must be completed first';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_start_dep_gate on public.tasks;
create trigger tasks_start_dep_gate
  before update of status on public.tasks
  for each row execute function public.enforce_start_no_open_predecessor();
