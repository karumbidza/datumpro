-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — a tender award must NOT wipe the winner's plan
--
-- set_task_pending_on_assign wipes a task's subtasks whenever the assignee changes
-- ("fresh plan for the new assignee"). That's right for a normal reassignment, but
-- a tender award sets the assignee to the winner whose plan is ALREADY in place —
-- the wipe was deleting exactly the plan we just awarded. Guard the wipe with a
-- transaction-local flag that award_tender raises, so only tender awards skip it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_task_pending_on_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    new.rejected_reason := null;
    -- Don't wipe when award_tender is installing the winner's plan.
    if tg_op = 'UPDATE' and coalesce(current_setting('app.tender_award', true), 'off') <> 'on' then
      delete from public.task_subtasks where task_id = new.id;  -- fresh plan for the new assignee
    end if;
    if coalesce(new.acceptance_status, 'pending') <> 'accepted'
       and exists (
         select 1 from public.project_members pm
         where pm.project_id = new.project_id
           and pm.user_id = new.assignee_id
           and pm.role in ('contractor', 'contributor')
       )
    then
      new.acceptance_status := 'pending';
      new.accepted_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.award_tender(p_task_id uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_project uuid; v_total bigint;
begin
  select org_id, project_id into v_org, v_project from public.tasks where id = p_task_id;
  if v_org is null then raise exception 'task not found'; end if;
  if not (select public.can_manage_project(v_project, v_org)) then
    raise exception 'only a project manager can award a tender';
  end if;
  if not exists (
    select 1 from public.task_tender_invites
    where task_id = p_task_id and contractor_id = p_winner and status = 'submitted'
  ) then
    raise exception 'that contractor has not submitted a bid';
  end if;

  update public.task_subtasks set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_subtasks
    where task_id = p_task_id and bid_contractor_id is not null;

  select coalesce(sum(cost_cents), 0) into v_total
    from public.task_subtasks
    where task_id = p_task_id and (is_variation = false or variation_status = 'approved');

  -- Keep the reassignment trigger from wiping the winner's plan.
  perform set_config('app.tender_award', 'on', true);
  update public.tasks set
    assignee_id = p_winner,
    acceptance_status = 'accepted',
    accepted_at = now(),
    plan_approved_at = now(),
    awarded_cost_cents = v_total
  where id = p_task_id;
  perform set_config('app.tender_award', 'off', true);

  update public.task_tender_invites set status = 'awarded', decided_at = now()
    where task_id = p_task_id and contractor_id = p_winner;
  update public.task_tender_invites set status = 'not_selected', decided_at = now()
    where task_id = p_task_id and contractor_id <> p_winner and status in ('invited', 'submitted');
end $$;
