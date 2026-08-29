-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — payment entitlement uses FLOORED progress
--
-- task_progress_pct (20260826000022) rounds — fine for the display progress bar,
-- but reused for payment gating it unlocks a milestone up to ~0.5% early: 49/200
-- subtasks = 24.5% rounds to 25 and releases the 25% milestone before it is truly
-- reached; 199/200 = 99.5% rounds to 100 and releases the FULL value (less
-- retention) while a subtask is still open and the task is not `done`.
--
-- Fix: task_payment_entitlement_cents computes its OWN progress with floor(), so a
-- milestone unlocks only once genuinely reached. task_progress_pct (display) keeps
-- rounding — untouched. Body is identical to 20260826000022 apart from the inlined
-- floored progress replacing the task_progress_pct() call.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.task_payment_entitlement_cents(p_task_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  with base as (
    select coalesce(tk.awarded_cost_cents, 0) as awarded,
           coalesce(p.retention_pct, 0)        as ret,
           -- Payment progress FLOORS (display task_progress_pct rounds): a milestone
           -- must be genuinely reached before it unlocks. Whole-task-priced tasks
           -- (no subtasks) unlock only at status = 'done'.
           case
             when tk.status = 'done' then 100
             else coalesce((
               select floor(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
               from public.task_subtasks s where s.task_id = tk.id
             ), 0)
           end as pct
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
