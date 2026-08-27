-- Whole-task tender bidding: a per-task tender bid is now ONE price + a works
-- note stored on the invite, not a priced subtask breakdown — matching the
-- direct-path accept_and_price_task model (20260826000011). The PM's award reads
-- the winner's bid figure and locks it onto the task. Bids stop creating
-- task_subtasks rows.

alter table public.task_tender_invites add column if not exists bid_price_cents bigint;
alter table public.task_tender_invites add column if not exists works_notes text;

-- ── submit_tender_bid: seal the invite with a whole-task price + works note.
--    Old signature (p_task_id) required ≥1 priced subtask; drop it.
drop function if exists public.submit_tender_bid(uuid);
create or replace function public.submit_tender_bid(
  p_task_id uuid,
  p_price_cents bigint,
  p_works_notes text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.task_tender_invites
    where task_id = p_task_id and contractor_id = v_uid and status in ('invited', 'submitted')
  ) then
    raise exception 'you are not invited to tender this task';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'a valid bid price is required';
  end if;
  if btrim(coalesce(p_works_notes, '')) = '' then
    raise exception 'describe the works to be done';
  end if;
  update public.task_tender_invites
     set status = 'submitted',
         submitted_at = now(),
         bid_price_cents = p_price_cents,
         works_notes = btrim(p_works_notes)
   where task_id = p_task_id and contractor_id = v_uid;
end $$;
grant execute on function public.submit_tender_bid(uuid, bigint, text) to authenticated;

-- ── award_tender: the winner's whole-task bid becomes the task's LOCKED price +
--    works note. Structurally the live version (20260826000010) — still a vetted
--    plan_approved_at writer that sets app.workflow_ctx past the phase-1 guard.
--    Only the value source changes: from summing the winner's subtasks to their
--    bid_price_cents, plus copying works_notes. The subtask/doc promote+delete
--    lines stay as harmless no-ops (a whole-task bid creates no subtask rows).
create or replace function public.award_tender(p_task_id uuid, p_winner uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_org uuid; v_project uuid; v_price bigint; v_notes text;
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
  select bid_price_cents, works_notes into v_price, v_notes
    from public.task_tender_invites
    where task_id = p_task_id and contractor_id = p_winner;
  if v_price is null then
    raise exception 'this bid has no price yet — ask the contractor to re-submit';
  end if;

  update public.task_subtasks set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_subtasks
    where task_id = p_task_id and bid_contractor_id is not null;

  update public.task_documents set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_documents
    where task_id = p_task_id and bid_contractor_id is not null;

  perform set_config('app.tender_award', 'on', true);
  -- Vetted approval path: authorise the plan_approved_at write past the phase-1
  -- guard_workflow_transition, like finalize_approval / export / accept_and_price.
  perform set_config('app.workflow_ctx', v_org::text, true);
  update public.tasks set
    assignee_id = p_winner,
    acceptance_status = 'accepted',
    accepted_at = now(),
    plan_approved_at = now(),
    awarded_cost_cents = v_price,
    works_notes = v_notes
  where id = p_task_id;
  perform set_config('app.tender_award', 'off', true);

  update public.task_tender_invites set status = 'awarded', decided_at = now()
    where task_id = p_task_id and contractor_id = p_winner;
  update public.task_tender_invites set status = 'not_selected', decided_at = now()
    where task_id = p_task_id and contractor_id <> p_winner and status in ('invited', 'submitted');
end $function$;
