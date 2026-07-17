-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — effort-weighted project progress
--
-- Previously project_progress was a plain average of per-task %, so a $2k snagging
-- task moved the project bar as much as a $200k structural package. This reweights
-- each task by its size using the awarded quote's cost as the Earned-Value weight.
--
-- Weight per task = awarded quote cost  →  else the project's average awarded cost
--                   →  else 1 (when no task in the project is priced at all).
-- The last fallback means an all-unpriced project collapses to a plain average,
-- so this is fully backward compatible. Costs are only ever aggregated inside this
-- SECURITY DEFINER function — no individual quote cost is exposed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_progress(p_project_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with per_task as (
    select
      case
        when t.status = 'done' then 100
        else coalesce((
          select round(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
          from public.task_subtasks s where s.task_id = t.id
        ), 0)
      end as pct,
      (
        select q.cost_cents from public.task_quotes q
        where q.task_id = t.id and q.status = 'awarded'
        order by q.decided_at desc nulls last
        limit 1
      ) as cost
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
