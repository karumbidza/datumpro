-- Universal no-backdating guard for start dates.
--
-- The web server actions already reject a backdated start, but the mobile app
-- writes to Supabase directly (RLS, no server action), so enforcement belongs in
-- the database to cover every client (web, mobile, API, SQL).
--
-- Rule: planned_start_date may not be earlier than today. Fires only when the
-- value is actually being set (INSERT) or changed (UPDATE) — editing other fields
-- on a task/step whose start is already in the past is still allowed, and existing
-- historical rows are never touched.

create or replace function public.enforce_no_backdated_start()
  returns trigger
  language plpgsql
as $function$
begin
  if new.planned_start_date is not null
     and new.planned_start_date < current_date
     and (tg_op = 'INSERT' or new.planned_start_date is distinct from old.planned_start_date)
  then
    raise exception 'The start date can''t be in the past.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists tasks_no_backdated_start on public.tasks;
create trigger tasks_no_backdated_start
  before insert or update of planned_start_date on public.tasks
  for each row execute function public.enforce_no_backdated_start();

drop trigger if exists task_subtasks_no_backdated_start on public.task_subtasks;
create trigger task_subtasks_no_backdated_start
  before insert or update of planned_start_date on public.task_subtasks
  for each row execute function public.enforce_no_backdated_start();
