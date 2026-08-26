-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — richer audit trail: capture where/why an action came from
--
-- audit_logs recorded who/what/when but not the request context. For real
-- forensics on money + authorization actions we want the source IP, user agent,
-- and a request/trace id, plus an optional human "reason" (already implicit in a
-- reject note or payment reference). All nullable and additive:
--   • app-layer writes (logAudit) auto-populate ip/user_agent/request_id from the
--     request headers — zero call-site churn.
--   • DB-side writers (triggers/RPCs) legitimately leave them null (no HTTP
--     context) — a null ip on a service/system action is itself informative.
--
-- ip is TEXT (not inet) so a malformed proxy header can never make an audit write
-- fail — audit robustness beats type purity here.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_logs
  add column if not exists ip          text,
  add column if not exists user_agent  text,
  add column if not exists request_id  text,
  add column if not exists reason      text;
