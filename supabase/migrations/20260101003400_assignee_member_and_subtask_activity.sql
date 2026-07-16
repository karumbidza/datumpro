-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — backbone hardening
--
-- 1. A task may only be assigned to a member of its project. The UI already only
--    lists project members, but this closes the gap for any direct/API write and
--    guarantees the acceptance flow + RLS always line up. Covers create, reassign,
--    and quote award (winners are always project contractors).
-- 2. Subtask plan changes (add / complete / reopen) are logged to the task
--    activity feed for accountability.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_assignee_is_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.assignee_id
    ) then
      raise exception 'A task can only be assigned to a member of its project';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assignee_member on public.tasks;
create trigger tasks_assignee_member
  before insert or update of assignee_id on public.tasks
  for each row execute function public.enforce_assignee_is_member();

create or replace function public.log_subtask_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_msg text;
begin
  if tg_op = 'INSERT' then
    v_msg := 'Added a step: ' || new.title;
  elsif tg_op = 'UPDATE' and new.is_done is distinct from old.is_done then
    v_msg := case when new.is_done then 'Completed step: ' || new.title
                  else 'Reopened step: ' || new.title end;
  else
    return null;
  end if;
  insert into public.task_activity (org_id, task_id, user_id, type, message)
  values (new.org_id, new.task_id, (select auth.uid()), 'plan', v_msg);
  return null;
end;
$$;

drop trigger if exists task_subtasks_activity on public.task_subtasks;
create trigger task_subtasks_activity
  after insert or update on public.task_subtasks
  for each row execute function public.log_subtask_activity();
