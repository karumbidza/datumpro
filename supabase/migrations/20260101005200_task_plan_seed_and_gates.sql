-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — plan/variation seeding + gates (Phase 2)
--
-- The columns + approval branches landed in 20260101005100. This wires the
-- lifecycle triggers so the flow is enforced server-side regardless of client:
--   • submitting a plan seeds its PM→Admin chain (and clears a stale one on
--     resubmit after a rejection);
--   • whether a NEW subtask is a baseline line or a variation is decided by the
--     task's plan state in the DB — a client can't sneak un-approved scope in;
--   • a variation subtask seeds its own PM→Admin chain on insert;
--   • work can't start until the plan is approved.
--
-- Plus a one-time backfill so tasks already in flight under the old model aren't
-- frozen by the new start-gate.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Grandfather in-flight accepted tasks: treat their acceptance as the plan
--    approval and snapshot their (currently zero) cost, so the start-gate below
--    never blocks work that's already underway.
update public.tasks
  set plan_approved_at = coalesce(accepted_at, updated_at),
      awarded_cost_cents = coalesce(
        (select sum(cost_cents) from public.task_subtasks s where s.task_id = tasks.id), 0)
  where acceptance_status = 'accepted'
    and plan_approved_at is null
    and status in ('in_progress', 'submitted', 'done');

-- 1. Baseline-vs-variation is the DB's call, from the task's plan state:
--    • plan approved  → the addition is a variation (pending approval)
--    • plan submitted → locked for review; reject the change
--    • otherwise      → a normal baseline plan line
create or replace function public.set_subtask_variation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approved timestamptz; v_submitted timestamptz;
begin
  select plan_approved_at, plan_submitted_at
    into v_approved, v_submitted
  from public.tasks where id = new.task_id;

  if v_approved is not null then
    new.is_variation := true;
    new.variation_status := 'pending';
  elsif v_submitted is not null then
    raise exception 'The plan is awaiting approval and cannot be changed right now';
  else
    new.is_variation := false;
    new.variation_status := null;
  end if;
  return new;
end $$;

drop trigger if exists task_subtasks_variation_flag on public.task_subtasks;
create trigger task_subtasks_variation_flag
  before insert on public.task_subtasks
  for each row execute function public.set_subtask_variation_flag();

-- 2. A variation subtask seeds its own approval chain on insert.
create or replace function public.seed_task_variation_approvals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_variation then
    perform public.seed_approval_steps('task_variation', new.id, new.org_id, coalesce(new.cost_cents, 0));
  end if;
  return new;
end $$;

drop trigger if exists task_subtasks_seed_variation on public.task_subtasks;
create trigger task_subtasks_seed_variation
  after insert on public.task_subtasks
  for each row execute function public.seed_task_variation_approvals();

-- 3. Submitting a plan seeds the task_plan chain. On resubmit (after a rejection
--    reset plan_submitted_at to null) the stale rejected rows are cleared first,
--    so the fresh chain isn't instantly re-rejected by leftover history.
create or replace function public.seed_task_plan_approvals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.plan_submitted_at is not null and old.plan_submitted_at is null then
    delete from public.approvals where entity_type = 'task_plan' and entity_id = new.id;
    perform public.seed_approval_steps('task_plan', new.id, new.org_id,
      coalesce((select sum(cost_cents) from public.task_subtasks
                where task_id = new.id and (is_variation = false or variation_status = 'approved')), 0)::bigint);
  end if;
  return new;
end $$;

drop trigger if exists tasks_seed_plan_approvals on public.tasks;
create trigger tasks_seed_plan_approvals
  after update of plan_submitted_at on public.tasks
  for each row execute function public.seed_task_plan_approvals();

-- 4. Work can't start until the plan is approved (only for tasks that went
--    through acceptance; internal-staff tasks with no acceptance are unaffected).
create or replace function public.enforce_start_plan_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress'
     and new.acceptance_status is not null
     and new.plan_approved_at is null then
    raise exception 'The task plan must be approved before work can start';
  end if;
  return new;
end $$;

drop trigger if exists tasks_start_gate on public.tasks;
create trigger tasks_start_gate
  before update of status on public.tasks
  for each row execute function public.enforce_start_plan_approved();
