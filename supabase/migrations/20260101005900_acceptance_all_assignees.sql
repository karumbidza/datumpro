-- Acceptance flow for every assignee, not just contractors/contributors.
--
-- Previously set_task_pending_on_assign() only flipped a task to
-- acceptance_status='pending' when the assignee's project role was
-- 'contractor' or 'contributor'. Internal staff (PM, admin, finance, …) were
-- assigned tasks that skipped the accept → plan → price flow entirely and
-- landed straight on the plain checklist. Product decision: the acceptance +
-- priced-plan flow applies to ALL assignees uniformly.
--
-- We keep the existing guards intact:
--   * only fires when assignee_id actually changes,
--   * clears a stale rejection reason,
--   * wipes the previous assignee's plan lines on reassignment (unless we're
--     inside award_tender, which sets app.tender_award='on' to preserve the
--     winning bid),
--   * never downgrades an already-'accepted' task back to 'pending'.
-- The only change is removing the project-role EXISTS filter.

create or replace function public.set_task_pending_on_assign()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    new.rejected_reason := null;
    if tg_op = 'UPDATE' and coalesce(current_setting('app.tender_award', true), 'off') <> 'on' then
      delete from public.task_subtasks where task_id = new.id;
    end if;
    if coalesce(new.acceptance_status, 'pending') <> 'accepted' then
      new.acceptance_status := 'pending';
      new.accepted_at := null;
    end if;
  end if;
  return new;
end;
$function$;

-- Backfill: internal-staff tasks created before this change have a null
-- acceptance_status and are stuck on the plain checklist. Bring any assigned,
-- not-yet-done task into the acceptance flow. This is a plain column update
-- (not an assignee change), so the trigger above does not fire and no plan
-- lines are deleted.
update public.tasks
   set acceptance_status = 'pending',
       accepted_at = null
 where assignee_id is not null
   and acceptance_status is null
   and status <> 'done';
