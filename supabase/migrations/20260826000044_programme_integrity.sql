-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — programme scheduler integrity & permission hardening
--
-- (1) Only a manager may change a task's SCHEDULE. tasks_update RLS lets an
--     assignee update their own task (for status/progress) — which unintentionally
--     also let them move the bar / reorder the programme. RLS can't restrict
--     columns, so guard the three planning columns with a trigger. Vetted definer
--     flows set app.workflow_ctx and are exempt (as with guard_workflow_transition);
--     the scheduler and award/generate run under a manager's own session so they
--     pass the role check.
-- (2) A dependency must link two tasks in the SAME project (FKs only enforce org).
-- (3) Bound lag_days; extend the cycle guard to cover updates.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_task_planning_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.planned_start_date is distinct from old.planned_start_date
      or new.planned_end_date is distinct from old.planned_end_date
      or new.programme_order is distinct from old.programme_order)
     and not (
       public.is_org_staff(new.org_id)
       or coalesce(public.project_role(new.project_id) = 'pm', false)
       or current_setting('app.workflow_ctx', true) is not distinct from new.org_id::text
     )
  then
    raise exception 'Only a project manager can change the programme (dates or order)';
  end if;
  return new;
end $$;

drop trigger if exists guard_task_planning_update_trg on public.tasks;
create trigger guard_task_planning_update_trg before update on public.tasks
  for each row execute function public.guard_task_planning_update();

create or replace function public.guard_task_dependency_same_project()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p_proj uuid; s_proj uuid;
begin
  select project_id into p_proj from public.tasks where id = new.predecessor_id;
  select project_id into s_proj from public.tasks where id = new.successor_id;
  if p_proj is null or s_proj is null or p_proj is distinct from s_proj then
    raise exception 'A dependency must link two tasks in the same project';
  end if;
  return new;
end $$;

drop trigger if exists guard_task_dependency_same_project_trg on public.task_dependencies;
create trigger guard_task_dependency_same_project_trg before insert or update on public.task_dependencies
  for each row execute function public.guard_task_dependency_same_project();

alter table public.task_dependencies
  drop constraint if exists task_dependencies_lag_bound;
alter table public.task_dependencies
  add constraint task_dependencies_lag_bound check (lag_days between -3650 and 3650);

drop trigger if exists task_dependencies_cycle on public.task_dependencies;
create trigger task_dependencies_cycle before insert or update on public.task_dependencies
  for each row execute function public.check_task_dep_cycle();
