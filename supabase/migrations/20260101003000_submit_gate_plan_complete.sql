-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — a task can't be submitted with an incomplete plan (DB-enforced)
--
-- The web + mobile submit actions already check this, but that's a check-then-act
-- race (a step could be un-ticked between the check and the write) and can be
-- bypassed by any other client. Enforce it at the row level as the hard gate.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_submit_plan_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if exists (select 1 from public.task_subtasks where task_id = new.id and not is_done) then
      raise exception 'Complete every step in the task plan before submitting for approval';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_submit_gate on public.tasks;
create trigger tasks_submit_gate
  before update of status on public.tasks
  for each row execute function public.enforce_submit_plan_complete();
