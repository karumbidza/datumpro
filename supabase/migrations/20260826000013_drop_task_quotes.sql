-- Retire the orphaned task_quotes table. The multi-contractor quote flow it
-- backed was dead code (removed from the app in the whole-task-pricing pass);
-- the live contractor price now lives on tasks.awarded_cost_cents (set by
-- accept_and_price_task / award_tender / export_award_to_project).
--
-- One live DB reader remained: project_progress() weighted Earned Value by the
-- awarded task_quotes cost (a LANGUAGE sql function, so it hard-depends on the
-- table). Repoint it at tasks.awarded_cost_cents FIRST — same weighting, live
-- source, still backward-compatible — then drop the table. No `cascade`: if any
-- other dependency remains, this migration fails loudly instead of silently
-- dropping it.

create or replace function public.project_progress(p_project_id uuid)
 returns integer
 language sql
 stable security definer
 set search_path to ''
as $function$
  with per_task as (
    select
      case
        when t.status = 'done' then 100
        else coalesce((
          select round(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
          from public.task_subtasks s where s.task_id = t.id
        ), 0)
      end as pct,
      -- Earned-Value weight = the task's locked awarded value (was the awarded
      -- task_quotes cost). 0 counts as "unpriced" so it falls back to the mean.
      nullif(t.awarded_cost_cents, 0) as cost
    from public.tasks t
    where t.project_id = p_project_id
  ),
  avg_cost as (
    select avg(cost)::numeric as ac from per_task where cost is not null
  )
  select coalesce(
    round(
      sum(pct * coalesce(cost, (select ac from avg_cost), 1))
      / nullif(sum(coalesce(cost, (select ac from avg_cost), 1)), 0)
    )::int,
    0
  )
  from per_task;
$function$;

-- Drops the table together with its own trigger (task_quotes_touch) and RLS
-- policies, and removes it from the supabase_realtime publication.
drop table if exists public.task_quotes;
