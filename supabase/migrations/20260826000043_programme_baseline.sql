-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — capture a programme baseline for variance tracking
--
-- The baseline is the plan frozen at a point in time (the approved programme).
-- As tasks are rescheduled, the live plan drifts from it; showing baseline vs
-- current is how slippage is read on a Gantt. tasks.baseline_start_date /
-- baseline_end_date already exist but nothing populated them and there was no way
-- to (re)capture a baseline.
--
-- set_project_baseline snapshots every scheduled task's current planned window
-- into its baseline columns and stamps projects.baselined_at. Managers only —
-- the permission check mirrors the tasks/projects RLS (can_manage_project).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists baselined_at timestamptz;

create or replace function public.set_project_baseline(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.projects where id = p_project_id;
  if v_org is null then
    raise exception 'project not found';
  end if;
  if not public.can_manage_project(p_project_id, v_org) then
    raise exception 'not authorized to baseline this project';
  end if;

  update public.tasks
     set baseline_start_date = planned_start_date,
         baseline_end_date = coalesce(planned_end_date, due_date)
   where project_id = p_project_id
     and planned_start_date is not null;

  update public.projects set baselined_at = now() where id = p_project_id;
end $$;
