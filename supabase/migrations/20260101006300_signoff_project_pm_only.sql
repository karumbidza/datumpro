-- Task sign-off (approving a submitted task as done) is the assigned project
-- manager's call only for now — not org owners/admins. Tightens the guard from
-- can_manage_project (admin OR pm) to strictly the project's PM.
create or replace function public.guard_task_signoff()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    if (select auth.uid()) is not null
       and coalesce(public.project_role(new.project_id), '') <> 'pm' then
      raise exception 'only the assigned project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$function$;
