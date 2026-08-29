-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — progress-linked payment milestones + retention
--
-- Payment is unlocked in steps as a task progresses: 25 / 50 / 75 / 90 / 100 %.
-- The cumulative amount claimable to date is the highest reached milestone of the
-- awarded value, LESS retention (projects.retention_pct, held back until release).
-- A contractor can only claim up to that net entitlement minus what they've already
-- claimed — replacing the old "claim the full awarded value any time" behaviour.
--
-- Progress is derived (no new input): 100 % when the task is done, otherwise the
-- share of subtasks marked done (0 % when there are none — a whole-task-priced task
-- unlocks its first milestone only at done). Retention release is a later phase;
-- for now retention simply accrues (is never claimable).
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-task % complete (same derivation the project bar uses).
create or replace function public.task_progress_pct(p_task_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case
    when t.status = 'done' then 100
    else coalesce((
      select round(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
      from public.task_subtasks s where s.task_id = t.id
    ), 0)
  end
  from public.tasks t where t.id = p_task_id;
$$;

-- Cumulative net entitlement to date = (highest reached milestone % of awarded)
-- minus retention on that gross valuation. Milestones step at 25/50/75/90/100.
create or replace function public.task_payment_entitlement_cents(p_task_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  with base as (
    select coalesce(tk.awarded_cost_cents, 0) as awarded,
           coalesce(p.retention_pct, 0)        as ret,
           public.task_progress_pct(tk.id)     as pct
    from public.tasks tk
    join public.projects p on p.id = tk.project_id
    where tk.id = p_task_id
  ),
  stepped as (
    select awarded, ret,
      case
        when pct >= 100 then 100 when pct >= 90 then 90 when pct >= 75 then 75
        when pct >= 50 then 50   when pct >= 25 then 25 else 0
      end as milestone
    from base
  ),
  wdd as (
    select floor(milestone::numeric / 100 * awarded)::bigint as gross, ret from stepped
  )
  select coalesce((gross - floor(ret / 100 * gross))::bigint, 0) from wdd;
$$;

-- Notification dedup: the highest milestone finance has already been told about.
alter table public.tasks
  add column if not exists payment_milestone_notified int not null default 0;

-- Rewrite the claim cap: was the full awarded value; now the progress-and-retention
-- entitlement. Also exclude 'cancelled' from the used sum (a withdrawn request frees
-- its slot), matching the app. The on_payment_request_insert trigger already points
-- at this function, so replacing the body is enough.
create or replace function public.enforce_payment_request_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_assignee    uuid;
  v_awarded     bigint;
  v_approved    timestamptz;
  v_used        bigint;
  v_entitlement bigint;
begin
  if new.task_id is null then
    raise exception 'A payment request must reference a task';
  end if;
  if new.invoice_path is null then
    raise exception 'An invoice is required to request payment';
  end if;
  select assignee_id, coalesce(awarded_cost_cents, 0), plan_approved_at
    into v_assignee, v_awarded, v_approved
    from public.tasks where id = new.task_id;
  if v_assignee is null or v_assignee is distinct from new.contractor_id then
    raise exception 'Only the task assignee can request payment for it';
  end if;
  if v_approved is null or v_awarded <= 0 then
    raise exception 'This task has no approved plan amount to invoice';
  end if;

  select coalesce(sum(amount_cents), 0) into v_used
    from public.contractor_payment_requests
    where task_id = new.task_id
      and contractor_id = new.contractor_id
      and status not in ('rejected', 'cancelled');

  v_entitlement := public.task_payment_entitlement_cents(new.task_id);
  if v_used + new.amount_cents > v_entitlement then
    raise exception 'Amount exceeds what''s claimable at this stage — progress unlocks payment in steps (25/50/75/90/100%%) and retention is held back';
  end if;
  return new;
end;
$function$;
