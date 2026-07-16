-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — subtasks must live inside the parent task's timeline
--
-- A subtask's dates can't fall outside the task's planned window, and its start
-- can't be after its end. Enforced in the DB so it holds on web and mobile and
-- for any future client. Also tidies project_progress into a single pass.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_subtask_window()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t_start date;
  t_end   date;
begin
  -- start ≤ end within the subtask itself.
  if new.planned_start_date is not null and new.planned_end_date is not null
     and new.planned_start_date > new.planned_end_date then
    raise exception 'Subtask start date must be on or before its end date';
  end if;

  select planned_start_date, coalesce(planned_end_date, due_date)
    into t_start, t_end
    from public.tasks where id = new.task_id;

  -- Lower bound: nothing before the task starts.
  if t_start is not null then
    if new.planned_start_date is not null and new.planned_start_date < t_start then
      raise exception 'Subtask cannot start before the task starts (%)', t_start;
    end if;
    if new.planned_end_date is not null and new.planned_end_date < t_start then
      raise exception 'Subtask cannot end before the task starts (%)', t_start;
    end if;
  end if;

  -- Upper bound: nothing after the task's end / due date.
  if t_end is not null then
    if new.planned_end_date is not null and new.planned_end_date > t_end then
      raise exception 'Subtask cannot end after the task is due (%)', t_end;
    end if;
    if new.planned_start_date is not null and new.planned_start_date > t_end then
      raise exception 'Subtask cannot start after the task is due (%)', t_end;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists task_subtasks_window on public.task_subtasks;
create trigger task_subtasks_window
  before insert or update of planned_start_date, planned_end_date on public.task_subtasks
  for each row execute function public.enforce_subtask_window();

-- Single-pass project rollup (was calling task_progress() per row).
create or replace function public.project_progress(p_project_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  with per_task as (
    select case
      when t.status = 'done' then 100
      else coalesce((
        select round(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
        from public.task_subtasks s where s.task_id = t.id
      ), 0)
    end as pct
    from public.tasks t where t.project_id = p_project_id
  )
  select coalesce(round(avg(pct))::int, 0) from per_task;
$$;
