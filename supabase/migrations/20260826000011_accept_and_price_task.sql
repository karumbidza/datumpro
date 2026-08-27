-- Whole-task pricing: a contractor accepts an assigned task by naming a single
-- price and describing the works — and that acceptance LOCKS the price (no
-- subtask breakdown, no separate approval step). This replaces the old
-- "accept, then build a priced subtask plan, then PM+admin approve" path for
-- the direct-assignment flow.

-- The contractor's description of the works to be done, captured at accept time.
alter table public.tasks add column if not exists works_notes text;

-- Accept + price + lock, in one definer call. The awarded value and the lock
-- flag (plan_approved_at) are normally set only by finalize_approval, so this
-- runs SECURITY DEFINER and re-checks that the caller is the pending assignee.
-- plan_approved_at is protected by guard_workflow_transition (20260826000002),
-- so this vetted approval path sets app.workflow_ctx to the task's org before
-- the write, exactly like finalize_approval / award_tender / export_award_to_project.
create or replace function public.accept_and_price_task(
  p_task_id uuid,
  p_price_cents bigint,
  p_works_notes text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
  v_status text;
  v_org uuid;
begin
  select assignee_id, acceptance_status, org_id
    into v_assignee, v_status, v_org
    from public.tasks
   where id = p_task_id;

  if not found then
    raise exception 'Task not found';
  end if;
  if v_assignee is null or v_assignee is distinct from auth.uid() then
    raise exception 'Only the assigned contractor can accept and price this task';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'This task is not awaiting acceptance';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'A valid task price is required';
  end if;

  perform set_config('app.workflow_ctx', v_org::text, true);
  update public.tasks
     set acceptance_status = 'accepted',
         accepted_at       = now(),
         awarded_cost_cents = p_price_cents,
         plan_approved_at  = now(),                     -- the lock
         works_notes       = nullif(btrim(coalesce(p_works_notes, '')), '')
   where id = p_task_id;
end;
$$;

grant execute on function public.accept_and_price_task(uuid, bigint, text) to authenticated;
