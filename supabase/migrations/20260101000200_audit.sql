-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — audit log
--
-- Append-only history of consequential actions (finance + authorisation especially).
-- Written server-side via the service role; clients can read their org's entries
-- but never insert/alter them.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  entity_type text not null,         -- e.g. 'invoice', 'request', 'project'
  entity_id   uuid,
  action      text not null,         -- e.g. 'created', 'approved', 'payment.recorded'
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_entity_idx   on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Read-only for org members; no insert/update/delete policy → only the service
-- role (which bypasses RLS) can write. The log stays tamper-evident.
create policy audit_logs_select on public.audit_logs for select
  using (public.is_org_member(org_id));
