-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — restrict audit log reads to owner/admin
--
-- The original policy allowed any org MEMBER to read audit_logs. In this model,
-- contractors and clients are org members, so that would expose finance actions
-- (invoice/payment before/after) to them. The audit log is a governance tool for
-- org leadership — restrict SELECT to owner/admin. Writes remain service-role only
-- (append-only, tamper-evident).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists audit_logs_select on public.audit_logs;

create policy audit_logs_select on public.audit_logs for select
  using ((select public.is_org_admin(org_id)));
