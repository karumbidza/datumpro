-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — a completed plan step can't be un-ticked
--
-- Completion counts toward sign-off, so it's final. The web action already guards
-- this, but the mobile app updates task_subtasks directly (no server action), so
-- enforce it at the source: reject any is_done true→false transition.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.prevent_subtask_untick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_done and not new.is_done then
    raise exception 'A completed step cannot be un-ticked';
  end if;
  return new;
end $$;

drop trigger if exists task_subtasks_no_untick on public.task_subtasks;
create trigger task_subtasks_no_untick
  before update of is_done on public.task_subtasks
  for each row execute function public.prevent_subtask_untick();
