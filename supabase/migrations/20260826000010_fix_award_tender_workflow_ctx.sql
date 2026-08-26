-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — fix: award_tender must set app.workflow_ctx before approving the plan.
--
-- Same class as 20260826000009. Phase 1's guard_workflow_transition on
-- tasks.plan_approved_at only accepts a write when app.workflow_ctx = the row's
-- org. award_tender already set app.tender_award='on' (an unrelated, older GUC
-- that tells the reassignment-cleanup trigger to PRESERVE the plan — it is not
-- read by the phase1 guard), but never set app.workflow_ctx, so the guard blocked
-- its plan_approved_at NULL→now() write — breaking per-task tender award in
-- production. Add the workflow_ctx set alongside the existing tender_award set.
-- Body otherwise identical to the live definition.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.award_tender(p_task_id uuid, p_winner uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
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

  update public.task_documents set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_documents
    where task_id = p_task_id and bid_contractor_id is not null;

  select coalesce(sum(cost_cents), 0) into v_total
    from public.task_subtasks
    where task_id = p_task_id and (is_variation = false or variation_status = 'approved');

  perform set_config('app.tender_award', 'on', true);
  -- Vetted approval path: authorise the plan_approved_at write past
  -- guard_workflow_transition (phase 1), exactly like finalize_approval / export.
  perform set_config('app.workflow_ctx', v_org::text, true);
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
end $function$;
