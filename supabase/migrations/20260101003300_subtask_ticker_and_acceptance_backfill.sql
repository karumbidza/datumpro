-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — only the contractor ticks their own steps + acceptance backfill
--
-- 1. A subtask's done state may only be changed by the task's assignee (the
--    contractor doing the work) — managers can see the plan but not tick it off.
--    Enforced at the row level so it holds regardless of client.
-- 2. Backfill: tasks assigned to a contractor before the acceptance feature
--    existed had no acceptance_status. Unstarted (todo) ones now require it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_subtask_ticker()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t_assignee uuid;
begin
  if new.is_done is distinct from old.is_done then
    select assignee_id into t_assignee from public.tasks where id = new.task_id;
    if t_assignee is distinct from (select auth.uid()) then
      raise exception 'Only the assigned contractor can tick off their own task steps';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_subtasks_ticker on public.task_subtasks;
create trigger task_subtasks_ticker
  before update of is_done on public.task_subtasks
  for each row execute function public.enforce_subtask_ticker();

update public.tasks t
  set acceptance_status = 'pending', accepted_at = null
where t.acceptance_status is null
  and t.status = 'todo'
  and t.assignee_id is not null
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = t.project_id and pm.user_id = t.assignee_id
      and pm.role in ('contractor','contributor')
  );
