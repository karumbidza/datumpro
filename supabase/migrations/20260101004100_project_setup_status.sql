-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project_setup_status view (Phase 1, §10)
--
-- Drives the post-create setup checklist. Adapted to what exists in Phase 1:
--  · commercial / payment_terms / location read the new projects columns
--  · wbs_done uses the existing `tasks` table (not the doc's future project_tasks)
--  · team / client_access approximate from the existing project_members.role enum
--    (no `party` column until Phase 2)
--  · permit / insurance are constant FALSE (no project_compliance_items until
--    Phase 4) so they render as outstanding with disabled links, by design.
--
-- security_invoker = true → the view respects the querying user's RLS, so callers
-- only see setup status for projects they can view.
-- ─────────────────────────────────────────────────────────────────────────────

create view public.project_setup_status
with (security_invoker = true) as
select
  p.id as project_id,
  (p.contract_value_cents > 0)                                        as commercial_done,
  (p.retention_pct is not null and p.payment_terms_days is not null)  as payment_terms_done,
  exists (select 1 from public.project_members m
          where m.project_id = p.id and m.role in ('client', 'viewer')) as client_access_done,
  exists (select 1 from public.project_members m
          where m.project_id = p.id and m.role = 'contributor')       as team_done,
  false                                                               as permit_done,
  false                                                               as insurance_done,
  exists (select 1 from public.tasks t where t.project_id = p.id)     as wbs_done,
  (p.latitude is not null)                                            as location_done
from public.projects p;

grant select on public.project_setup_status to authenticated;
