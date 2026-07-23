-- A project moves from 'planning' to 'active' as soon as any of its tasks starts
-- (first transition into in_progress). Covers every client via the DB.
create or replace function public.bump_project_active_on_task_start()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    update public.projects set status = 'active'
      where id = new.project_id and status = 'planning';
  end if;
  return new;
end;
$function$;

drop trigger if exists tasks_bump_project_active on public.tasks;
create trigger tasks_bump_project_active
  after update of status on public.tasks
  for each row execute function public.bump_project_active_on_task_start();
