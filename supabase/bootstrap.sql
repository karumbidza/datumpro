-- DatumPro — consolidated schema bootstrap (generated from supabase/migrations/*).
-- Paste into Supabase Studio → SQL Editor → Run (fresh project).


-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000000_init_tenancy.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — identity & tenancy
--
-- Multi-tenancy is enforced in the DATABASE via Row-Level Security: every
-- tenant-owned row carries `org_id`, and policies allow access only to members of
-- that org. App code can't forget to scope a query — Postgres does it.
--
-- Security-by-design notes:
--   • Helper functions are SECURITY DEFINER (to read org_members without RLS
--     recursion) AND hardened with `set search_path = ''` + fully-qualified names,
--     so they can't be subverted by a malicious object in another schema.
--   • Policy predicates wrap auth/helper calls in `(select …)` so Postgres
--     evaluates them once per statement (initplan) instead of once per row —
--     this is what keeps RLS cheap as orgs/rows scale.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.org_role      as enum ('owner', 'admin', 'finance', 'pm', 'member', 'viewer');
create type public.member_status as enum ('active', 'invited', 'disabled');

-- ── Profiles (mirror of auth.users for display data) ─────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- ── Organizations (the tenant) ───────────────────────────────────────────────
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  created_at timestamptz not null default now(),
  -- Referenced by composite FKs on child tables so a child's org_id is forced to
  -- equal its parent's — no cross-tenant references possible (id is already unique).
  unique (id)
);

create table public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.org_role not null default 'member',
  status     public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
-- (user_id, org_id) composite serves the membership lookup in is_org_member /
-- org_role (both columns equality-filtered).
create index org_members_user_org_idx on public.org_members (user_id, org_id);
create index org_members_org_idx       on public.org_members (org_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  token       text not null unique,
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (org_id);

-- ── Access helper functions (SECURITY DEFINER + hardened search_path) ─────────
create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function public.org_role(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role::text from public.org_members m
  where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
$$;

-- True if the current user shares any org with `p_user_id` (profile visibility).
create or replace function public.shares_org(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on them.org_id = me.org_id
    where me.user_id = (select auth.uid()) and me.status = 'active'
      and them.user_id = p_user_id and them.status = 'active'
  );
$$;

-- ── Triggers: bootstrap profile on signup, owner membership on org creation ───
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    insert into public.org_members (org_id, user_id, role, status)
    values (new.id, (select auth.uid()), 'owner', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_org_created
  after insert on public.organizations
  for each row execute function public.handle_new_org();

-- ── Row-Level Security ───────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.invitations   enable row level security;

-- profiles: see yourself + anyone you share an org with; edit only yourself
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or (select public.shares_org(id)));
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizations: members read; any authed user may create (trigger makes them
-- owner); owners/admins update; owners delete
create policy organizations_select on public.organizations for select
  using ((select public.is_org_member(id)));
create policy organizations_insert on public.organizations for insert
  with check ((select auth.uid()) is not null);
create policy organizations_update on public.organizations for update
  using ((select public.org_role(id)) in ('owner', 'admin'))
  with check ((select public.org_role(id)) in ('owner', 'admin'));
create policy organizations_delete on public.organizations for delete
  using ((select public.org_role(id)) = 'owner');

-- org_members: members see co-members; owners/admins manage
create policy org_members_select on public.org_members for select
  using ((select public.is_org_member(org_id)));
create policy org_members_write on public.org_members for all
  using ((select public.org_role(org_id)) in ('owner', 'admin'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin'));

-- invitations: owners/admins only
create policy invitations_manage on public.invitations for all
  using ((select public.org_role(org_id)) in ('owner', 'admin'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin'));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000100_projects.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — projects, members & milestones
--
-- Tenant-consistent references: child tables reference projects via the COMPOSITE
-- key (id, org_id), so a child row's org_id is forced to equal its project's
-- org_id. Cross-tenant references become impossible at the database level — even
-- with the service-role key.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.project_status   as enum ('planning', 'active', 'on_hold', 'completed', 'archived');
create type public.project_type     as enum ('construction', 'marketing', 'it', 'general');
create type public.project_role     as enum ('pm', 'contributor', 'client', 'viewer');
create type public.milestone_status as enum ('pending', 'in_progress', 'done', 'missed');

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  name                 text not null,
  code                 text,
  type                 public.project_type not null default 'construction',
  status               public.project_status not null default 'planning',
  client_name          text,
  contract_value_cents bigint not null default 0,  -- USD cents
  start_date           date,
  end_date             date,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  -- target for child composite FKs (id is already unique; this names it explicitly)
  unique (id, org_id)
);
create index projects_org_idx on public.projects (org_id);

create table public.project_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.project_role not null default 'contributor',
  created_at timestamptz not null default now(),
  unique (project_id, user_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index project_members_project_idx on public.project_members (project_id);

create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null,
  name        text not null,
  target_date date,
  status      public.milestone_status not null default 'pending',
  created_at  timestamptz not null default now(),
  constraint milestones_id_org_key unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index milestones_project_idx on public.milestones (project_id);

-- ── RLS: tenant isolation by org membership; mutation gated to delivery roles ──
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones      enable row level security;

create policy projects_select on public.projects for select
  using ((select public.is_org_member(org_id)));
create policy projects_write on public.projects for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy project_members_select on public.project_members for select
  using ((select public.is_org_member(org_id)));
create policy project_members_write on public.project_members for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy milestones_select on public.milestones for select
  using ((select public.is_org_member(org_id)));
create policy milestones_write on public.milestones for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000200_audit.sql
-- ═══════════════════════════════════════════════════════════════════════
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
  using ((select public.is_org_member(org_id)));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000300_monitoring.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — field monitoring: site reports + media
--
-- Offline-first tables (captured on site, synced via PowerSync). RLS lets any
-- active org member CREATE their own report/media; edits/deletes are restricted
-- to the author or delivery leads (pm/admin/owner).
--
-- Tenant-consistent references via composite FKs: site_reports → projects(id,
-- org_id); report_media → site_reports(id, org_id) AND projects(id, org_id).
-- ─────────────────────────────────────────────────────────────────────────────

create type public.report_status as enum ('draft', 'submitted');
create type public.media_type    as enum ('image', 'video');

create table public.site_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  -- nullable so we can keep the report (history) if the author is deleted
  author_id    uuid references auth.users(id) on delete set null,
  report_date  date not null default current_date,
  progress_pct smallint not null default 0 check (progress_pct between 0 and 100),
  narrative    text,
  weather      text,
  gps_lat      double precision,
  gps_lng      double precision,
  status       public.report_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index site_reports_project_idx on public.site_reports (project_id, report_date desc);
create index site_reports_org_idx     on public.site_reports (org_id);

create table public.report_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  report_id    uuid not null,
  storage_path text not null,           -- {org_id}/{project_id}/{report_id}/{file}
  media_type   public.media_type not null,
  captured_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (report_id, org_id)   references public.site_reports (id, org_id) on delete cascade
);
create index report_media_report_idx on public.report_media (report_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger site_reports_touch
  before update on public.site_reports
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.site_reports enable row level security;
alter table public.report_media enable row level security;

create policy site_reports_select on public.site_reports for select
  using ((select public.is_org_member(org_id)));
create policy site_reports_insert on public.site_reports for insert
  with check ((select public.is_org_member(org_id)) and author_id = (select auth.uid()));
create policy site_reports_update on public.site_reports for update
  using (author_id = (select auth.uid()) or (select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.is_org_member(org_id)));
create policy site_reports_delete on public.site_reports for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy report_media_select on public.report_media for select
  using ((select public.is_org_member(org_id)));
create policy report_media_insert on public.report_media for insert
  with check ((select public.is_org_member(org_id)));
create policy report_media_delete on public.report_media for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000400_storage.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — media storage bucket + access policies
--
-- Objects are keyed by a tenant path: {org_id}/{project_id}/{report_id}/{file}.
-- Access is granted by checking the FIRST path segment (org_id) against the
-- caller's org membership — same isolation model as the tables.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do nothing;

-- Safe cast: a malformed object name would make a raw `::uuid` cast throw inside
-- the policy. Return null instead → membership checks simply fail closed.
create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.is_org_member(public.safe_uuid((storage.foldername(name))[1])))
  );

create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (select public.is_org_member(public.safe_uuid((storage.foldername(name))[1])))
  );

create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.org_role(public.safe_uuid((storage.foldername(name))[1]))) in ('owner', 'admin', 'pm')
  );

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000500_finance.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — finance: budget/BOQ, variations, invoices, payment schedule,
--                     payments, proof-of-payment, Paynow. USD-only, integer cents.
--
-- Same security-by-design discipline as the rest of the model:
--   • Tenant-consistent references — every child references its parent by the
--     COMPOSITE key (id, org_id), so cross-tenant references are impossible.
--   • RLS: isolation by org membership; mutation gated by role with SEGREGATION
--     OF DUTIES (finance moves money; pm/owner handle delivery + variations).
--   • Money is bigint cents; line totals are GENERATED columns (no app drift).
--   • POP has a DB-level SoD check: the verifier must differ from the submitter.
-- ─────────────────────────────────────────────────────────────────────────────

-- Safety net for DBs created before milestones got its composite-FK target key.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'milestones_id_org_key') then
    alter table public.milestones add constraint milestones_id_org_key unique (id, org_id);
  end if;
end $$;

-- ── Enums (mirror @datumpro/shared/domain/finance) ───────────────────────────
create type public.invoice_status   as enum ('draft', 'sent', 'part_paid', 'paid', 'overdue', 'void');
create type public.payment_method   as enum ('paynow', 'bank_transfer', 'cash', 'other');
create type public.payment_status   as enum ('pending', 'confirmed', 'failed', 'refunded');
create type public.pop_status       as enum ('submitted', 'verified', 'rejected');
create type public.paynow_status    as enum ('created', 'sent', 'paid', 'cancelled', 'failed');
create type public.variation_status as enum ('draft', 'approved', 'rejected');
create type public.schedule_status  as enum ('pending', 'invoiced', 'paid');

-- ── Budget / Bill of Quantities ──────────────────────────────────────────────
create table public.budget_lines (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  project_id          uuid not null,
  code                text,
  description         text not null,
  category            text,
  unit                text,
  quantity            numeric(14,3) not null default 1,
  rate_cents          bigint not null default 0,
  budget_amount_cents bigint generated always as ((round(quantity * rate_cents))::bigint) stored,
  created_at          timestamptz not null default now(),
  constraint budget_lines_id_org_key unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index budget_lines_project_idx on public.budget_lines (project_id);

-- ── Variation orders (approved change orders adjust the budget/schedule) ──────
create table public.variation_orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null,
  reference         text,
  description       text not null,
  cost_impact_cents bigint not null default 0,   -- may be negative
  time_impact_days  integer not null default 0,
  status            public.variation_status not null default 'draft',
  created_by        uuid references auth.users(id) on delete set null,
  approved_by       uuid references auth.users(id) on delete set null,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index variation_orders_project_idx on public.variation_orders (project_id);

-- ── Invoices (out, to client) ────────────────────────────────────────────────
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null,
  number         text not null,
  issue_date     date not null default current_date,
  due_date       date,
  payment_terms  text,
  status         public.invoice_status not null default 'draft',
  subtotal_cents bigint not null default 0,
  tax_cents      bigint not null default 0,
  total_cents    bigint not null default 0,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint invoices_id_org_key unique (id, org_id),
  constraint invoices_org_number_key unique (org_id, number),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index invoices_project_idx    on public.invoices (project_id);
create index invoices_org_status_idx on public.invoices (org_id, status);
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

create table public.invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  invoice_id       uuid not null,
  budget_line_id   uuid,
  description      text not null,
  quantity         numeric(14,3) not null default 1,
  unit_price_cents bigint not null default 0,
  amount_cents     bigint generated always as ((round(quantity * unit_price_cents))::bigint) stored,
  created_at       timestamptz not null default now(),
  foreign key (invoice_id, org_id)     references public.invoices (id, org_id)     on delete cascade,
  -- NO ACTION: a budget line that's been invoiced against can't be deleted
  -- (archive instead) — and the composite keeps the link tenant-consistent.
  foreign key (budget_line_id, org_id) references public.budget_lines (id, org_id)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- ── Payment schedule (progress draws / milestone payments) ───────────────────
create table public.payment_schedule (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  milestone_id uuid,
  invoice_id   uuid,
  name         text not null,
  due_date     date,
  amount_cents bigint not null default 0,
  status       public.schedule_status not null default 'pending',
  created_at   timestamptz not null default now(),
  foreign key (project_id, org_id)   references public.projects (id, org_id)   on delete cascade,
  foreign key (milestone_id, org_id) references public.milestones (id, org_id),
  foreign key (invoice_id, org_id)   references public.invoices (id, org_id)
);
create index payment_schedule_project_idx on public.payment_schedule (project_id);

-- ── Payments (money received against an invoice) ─────────────────────────────
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  method       public.payment_method not null default 'paynow',
  status       public.payment_status not null default 'pending',
  reference    text,
  paid_at      timestamptz,
  recorded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint payments_id_org_key unique (id, org_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index payments_invoice_idx on public.payments (invoice_id);

-- ── Proof of payment (uploaded doc, verified by finance) ─────────────────────
create table public.proof_of_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invoice_id    uuid not null,
  payment_id    uuid,
  storage_path  text not null,
  status        public.pop_status not null default 'submitted',
  submitted_by  uuid references auth.users(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  verified_by   uuid references auth.users(id) on delete set null,
  verified_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  -- Segregation of duties: a POP can't be verified by the person who submitted it.
  constraint pop_verifier_not_submitter check (verified_by is null or verified_by <> submitted_by),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade,
  foreign key (payment_id, org_id) references public.payments (id, org_id)
);
create index proof_of_payments_invoice_idx on public.proof_of_payments (invoice_id);

-- ── Paynow transactions (collection records; webhook-driven) ─────────────────
create table public.paynow_transactions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null,
  reference    text,
  poll_url     text,
  status       public.paynow_status not null default 'created',
  amount_cents bigint not null default 0,
  payload      jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index paynow_invoice_idx   on public.paynow_transactions (invoice_id);
create index paynow_reference_idx on public.paynow_transactions (reference);
create trigger paynow_touch before update on public.paynow_transactions
  for each row execute function public.touch_updated_at();

-- ── RLS — isolation by org; mutation by role (segregation of duties) ─────────
alter table public.budget_lines        enable row level security;
alter table public.variation_orders    enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_lines       enable row level security;
alter table public.payment_schedule    enable row level security;
alter table public.payments            enable row level security;
alter table public.proof_of_payments   enable row level security;
alter table public.paynow_transactions enable row level security;

-- Budget + variations: delivery leads (pm/admin/owner) manage; everyone reads.
create policy budget_lines_select on public.budget_lines for select
  using ((select public.is_org_member(org_id)));
create policy budget_lines_write on public.budget_lines for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy variation_orders_select on public.variation_orders for select
  using ((select public.is_org_member(org_id)));
create policy variation_orders_write on public.variation_orders for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- Invoices + lines + payments: FINANCE (and owner/admin) only. Everyone reads.
create policy invoices_select on public.invoices for select
  using ((select public.is_org_member(org_id)));
create policy invoices_write on public.invoices for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));

create policy invoice_lines_select on public.invoice_lines for select
  using ((select public.is_org_member(org_id)));
create policy invoice_lines_write on public.invoice_lines for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));

create policy payments_select on public.payments for select
  using ((select public.is_org_member(org_id)));
create policy payments_write on public.payments for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));

-- Payment schedule: pm + finance (planning ↔ billing).
create policy payment_schedule_select on public.payment_schedule for select
  using ((select public.is_org_member(org_id)));
create policy payment_schedule_write on public.payment_schedule for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm', 'finance'));

-- Proof of payment: any member SUBMITS; only finance VERIFIES (update) / deletes.
create policy proof_of_payments_select on public.proof_of_payments for select
  using ((select public.is_org_member(org_id)));
create policy proof_of_payments_insert on public.proof_of_payments for insert
  with check ((select public.is_org_member(org_id)));
create policy proof_of_payments_update on public.proof_of_payments for update
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));
create policy proof_of_payments_delete on public.proof_of_payments for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));

-- Paynow: finance can initiate; webhooks write via the service role (bypasses RLS).
create policy paynow_transactions_select on public.paynow_transactions for select
  using ((select public.is_org_member(org_id)));
create policy paynow_transactions_write on public.paynow_transactions for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'finance'));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000600_requests.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — requests & authorisation
--
-- A request (RFI / purchase / variation / access) flows draft → submitted →
-- approved|rejected through an ordered approval chain materialised from per-org
-- approval policies (who must sign off, above what amount).
--
-- Security-by-design:
--   • Composite (id, org_id) FKs keep the whole chain tenant-consistent.
--   • Approval steps are created ONLY by submit_request() (SECURITY DEFINER) from
--     policy — clients cannot insert arbitrary approval rows.
--   • A user can only record themselves as approver, only for a step matching
--     their org role, and NEVER on their own request (DB trigger — segregation of
--     duties).
--   • Request status is finalised by trigger (all steps approved → approved; any
--     rejected → rejected) so state can't drift.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.request_type      as enum ('rfi', 'purchase', 'variation', 'access');
create type public.request_status    as enum ('draft', 'submitted', 'approved', 'rejected', 'cancelled');
create type public.approval_decision as enum ('pending', 'approved', 'rejected');

create table public.requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  type         public.request_type not null,
  title        text not null,
  description  text,
  amount_cents bigint,                       -- purchase/variation
  status       public.request_status not null default 'draft',
  raised_by    uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint requests_id_org_key unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index requests_project_idx on public.requests (project_id);
create index requests_org_status_idx on public.requests (org_id, status);
create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();

-- Per-org config: which role must approve which request type, above what amount,
-- in what order. An empty match = no approval required (auto-approve).
create table public.approval_policies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  request_type    public.request_type not null,
  min_amount_cents bigint not null default 0,
  approver_role   public.org_role not null,
  step_order      int not null default 1,
  created_at      timestamptz not null default now()
);
create index approval_policies_org_idx on public.approval_policies (org_id, request_type);

create table public.approvals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  request_id    uuid not null,
  step_order    int not null,
  approver_role public.org_role not null,
  approver_id   uuid references auth.users(id) on delete set null,
  decision      public.approval_decision not null default 'pending',
  comment       text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (request_id, org_id) references public.requests (id, org_id) on delete cascade
);
create index approvals_request_idx on public.approvals (request_id);

-- Link an approved variation request to the variation order it produces.
alter table public.variation_orders add column request_id uuid;
alter table public.variation_orders
  add constraint variation_orders_request_fk
  foreign key (request_id, org_id) references public.requests (id, org_id);

-- ── Segregation of duties: requester cannot approve their own request ─────────
create or replace function public.enforce_approval_sod()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_raised_by uuid;
begin
  if new.approver_id is not null then
    select raised_by into v_raised_by from public.requests where id = new.request_id;
    if v_raised_by is not null and v_raised_by = new.approver_id then
      raise exception 'segregation of duties: the requester cannot approve their own request';
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_sod before insert or update on public.approvals
  for each row execute function public.enforce_approval_sod();

-- ── Finalise the request once its chain resolves ─────────────────────────────
create or replace function public.finalize_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pending_count int; rejected_count int;
begin
  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pending_count, rejected_count
  from public.approvals where request_id = new.request_id;

  if rejected_count > 0 then
    update public.requests set status = 'rejected', decided_at = now(), updated_at = now()
      where id = new.request_id and status not in ('rejected', 'cancelled');
  elsif pending_count = 0 then
    update public.requests set status = 'approved', decided_at = now(), updated_at = now()
      where id = new.request_id and status = 'submitted';
  end if;
  return new;
end;
$$;
create trigger approvals_finalize after update on public.approvals
  for each row execute function public.finalize_request();

-- ── Submit a request: materialise its approval chain from policy ─────────────
-- Called by the app via rpc('submit_request', { p_request_id }). SECURITY DEFINER
-- so it can write approval rows that clients themselves cannot.
create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.requests; pol record; step int := 0;
begin
  select * into r from public.requests where id = p_request_id;
  if r.id is null then raise exception 'request not found'; end if;
  if not ((select auth.uid()) = r.raised_by
          or public.org_role(r.org_id) in ('owner', 'admin', 'pm')) then
    raise exception 'not allowed to submit this request';
  end if;
  if r.status <> 'draft' then raise exception 'request is not a draft'; end if;

  for pol in
    select * from public.approval_policies ap
    where ap.org_id = r.org_id and ap.request_type = r.type
      and coalesce(r.amount_cents, 0) >= ap.min_amount_cents
    order by ap.step_order
  loop
    step := step + 1;
    insert into public.approvals (org_id, request_id, step_order, approver_role, decision)
    values (r.org_id, r.id, step, pol.approver_role, 'pending');
  end loop;

  -- No matching policy → nothing to approve → auto-approve.
  -- (CASE over enum literals resolves to text; cast back explicitly because the
  --  function runs with search_path = '' so there's no implicit text→enum cast.)
  update public.requests
    set status = (case when step = 0 then 'approved' else 'submitted' end)::public.request_status,
        decided_at = case when step = 0 then now() else null end,
        updated_at = now()
    where id = r.id;
end;
$$;
grant execute on function public.submit_request(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.requests          enable row level security;
alter table public.approval_policies enable row level security;
alter table public.approvals         enable row level security;

-- requests: members read; raise their own; edit own draft; leads manage.
create policy requests_select on public.requests for select
  using ((select public.is_org_member(org_id)));
create policy requests_insert on public.requests for insert
  with check ((select public.is_org_member(org_id)) and raised_by = (select auth.uid()));
create policy requests_update on public.requests for update
  using (
    (raised_by = (select auth.uid()) and status = 'draft')
    or (select public.org_role(org_id)) in ('owner', 'admin', 'pm')
  )
  with check ((select public.is_org_member(org_id)));
create policy requests_delete on public.requests for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- approval policies: configured by owners/admins; readable by members.
create policy approval_policies_select on public.approval_policies for select
  using ((select public.is_org_member(org_id)));
create policy approval_policies_write on public.approval_policies for all
  using ((select public.org_role(org_id)) in ('owner', 'admin'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin'));

-- approvals: members read; NO client insert (only submit_request / service role);
-- a step can be decided only by someone holding its role (or owner/admin), and the
-- caller can only record THEMSELVES as the approver. The SoD trigger blocks self-
-- approval of one's own request.
create policy approvals_select on public.approvals for select
  using ((select public.is_org_member(org_id)));
create policy approvals_decide on public.approvals for update
  using (
    (select public.org_role(org_id)) = approver_role::text
    or (select public.org_role(org_id)) in ('owner', 'admin')
  )
  with check (approver_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000700_tasks.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task engine
--
-- The unit of assigned work, with the full SLA / blocker / dependency / photo
-- sign-off logic (see docs/FUNCTIONAL_SPEC.md). SLA *computation* (clock, deadline
-- crediting, escalation) lives in @datumpro/shared + Inngest jobs; this migration
-- owns the schema + the integrity rules that must hold no matter the caller:
--   • circular dependencies are rejected (trigger);
--   • only a PM/Admin/Owner (or the system) may approve a task to DONE (trigger);
--   • cross-tenant references impossible (composite FKs).
-- ─────────────────────────────────────────────────────────────────────────────

create type public.task_status     as enum ('todo', 'in_progress', 'submitted', 'blocked', 'done');
create type public.task_priority   as enum ('low', 'medium', 'high', 'urgent');
create type public.task_sla_status as enum
  ('on_track', 'at_risk', 'pending_signoff', 'blocked', 'breached', 'resolved_on_time', 'resolved_late');

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  project_id          uuid not null,
  milestone_id        uuid,
  budget_line_id      uuid,                       -- cost roll-up (budget vs actual)
  title               text not null,
  description         text,
  status              public.task_status   not null default 'todo',
  priority            public.task_priority not null default 'medium',
  assignee_id         uuid references auth.users(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  -- scheduling
  planned_start_date  date,
  planned_end_date    date,
  due_date            date,
  actual_start_date   timestamptz,
  actual_end_date     timestamptz,
  baseline_start_date date,                       -- frozen at creation for variance
  baseline_end_date   date,
  -- SLA
  sla_status          public.task_sla_status not null default 'on_track',
  sla_clock_started_at timestamptz,
  sla_clock_paused_at  timestamptz,
  sla_total_paused_ms  bigint not null default 0,
  sla_breach_count     int not null default 0,
  -- blocker
  blocker_raised_at    timestamptz,
  blocker_raised_by    uuid references auth.users(id) on delete set null,
  blocker_description  text,
  blocker_resolved_at  timestamptz,
  blocker_resolved_by  uuid references auth.users(id) on delete set null,
  -- sign-off (mandatory photo by default)
  requires_photo_on_complete boolean not null default true,
  submitted_at         timestamptz,
  submitted_by         uuid references auth.users(id) on delete set null,
  completion_notes     text,
  completion_photos    jsonb not null default '[]'::jsonb,  -- array of storage paths
  declaration_confirmed boolean not null default false,
  approved_at          timestamptz,
  approved_by          uuid references auth.users(id) on delete set null,
  rejected_at          timestamptz,
  rejected_by          uuid references auth.users(id) on delete set null,
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint tasks_id_org_key unique (id, org_id),
  foreign key (project_id, org_id)     references public.projects (id, org_id)     on delete cascade,
  foreign key (milestone_id, org_id)   references public.milestones (id, org_id),
  foreign key (budget_line_id, org_id) references public.budget_lines (id, org_id)
);
create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_org_idx            on public.tasks (org_id);
create index tasks_assignee_idx       on public.tasks (assignee_id);
create index tasks_due_idx            on public.tasks (due_date);
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ── Dependencies (predecessor → successor, with lag) ─────────────────────────
create table public.task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  predecessor_id uuid not null,
  successor_id   uuid not null,
  lag_days       int not null default 0,
  created_at     timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id),
  foreign key (predecessor_id, org_id) references public.tasks (id, org_id) on delete cascade,
  foreign key (successor_id, org_id)   references public.tasks (id, org_id) on delete cascade
);
create index task_dependencies_successor_idx   on public.task_dependencies (successor_id);
create index task_dependencies_predecessor_idx on public.task_dependencies (predecessor_id);

-- Reject a dependency that would create a cycle: if the successor can already
-- reach the predecessor through existing edges, the new edge closes a loop.
create or replace function public.check_task_dep_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    with recursive reach as (
      select new.successor_id as node
      union
      select d.successor_id from public.task_dependencies d
      join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = new.predecessor_id
  ) then
    raise exception 'circular task dependency';
  end if;
  return new;
end;
$$;
create trigger task_dependencies_cycle before insert on public.task_dependencies
  for each row execute function public.check_task_dep_cycle();

-- ── Task activity (timeline / audit) ─────────────────────────────────────────
create table public.task_activity (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  task_id    uuid not null,
  user_id    uuid references auth.users(id) on delete set null,
  type       text not null,                 -- 'created' | 'assigned' | 'status' | 'blocker' | ...
  message    text not null,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);
create index task_activity_task_idx on public.task_activity (task_id, created_at desc);

-- ── Sign-off authority: only a lead (or the system) may approve to DONE ──────
create or replace function public.guard_task_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    -- auth.uid() is null for system/service contexts (Inngest, webhooks) → allowed.
    if (select auth.uid()) is not null
       and public.org_role(new.org_id) not in ('owner', 'admin', 'pm') then
      raise exception 'only a project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$$;
create trigger tasks_signoff_guard before update on public.tasks
  for each row execute function public.guard_task_signoff();

-- ── Progress billing link: a scheduled draw can be tied to a task ────────────
alter table public.payment_schedule add column task_id uuid;
alter table public.payment_schedule
  add constraint payment_schedule_task_fk
  foreign key (task_id, org_id) references public.tasks (id, org_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.tasks             enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_activity     enable row level security;

-- tasks: members read; PM/admin/owner create + delete; the assignee may update
-- their own task (start / blocker / submit) and leads may update any. The sign-off
-- guard above stops a non-lead from setting DONE.
create policy tasks_select on public.tasks for select
  using ((select public.is_org_member(org_id)));
create policy tasks_insert on public.tasks for insert
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));
create policy tasks_update on public.tasks for update
  using (
    assignee_id = (select auth.uid())
    or (select public.org_role(org_id)) in ('owner', 'admin', 'pm')
  )
  with check ((select public.is_org_member(org_id)));
create policy tasks_delete on public.tasks for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- dependencies + activity: members read; leads manage dependencies; activity is
-- insert-only by any member (the app writes timeline entries).
create policy task_dependencies_select on public.task_dependencies for select
  using ((select public.is_org_member(org_id)));
create policy task_dependencies_write on public.task_dependencies for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy task_activity_select on public.task_activity for select
  using ((select public.is_org_member(org_id)));
create policy task_activity_insert on public.task_activity for insert
  with check ((select public.is_org_member(org_id)));


-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000800_project_isolation.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project-level isolation
--
-- Tenancy (the company) stays the outer boundary: org = customer, RLS on org_id,
-- composite (id, org_id) FKs make cross-tenant references impossible.
--
-- This migration adds the INNER boundary the product needs: within one company,
-- a project is an isolation unit. Two tiers of people:
--
--   • Company staff  — owner / admin / finance — see the WHOLE company
--     (the portfolio view). Owners & admins manage delivery; finance manages money.
--   • Project-scoped — anyone added to project_members (pm / contributor /
--     client / viewer) — see ONLY the projects they belong to. No leak between
--     projects.
--
-- Before this migration every read was gated by is_org_member(org_id), so any org
-- member could read every project's data. These policies replace that with
-- can_view_project(project_id, org_id) = is_org_staff(org) OR is_project_member(project).
--
-- Note: org-level role 'pm' is no longer a company-wide power role — "PM" is now a
-- per-project capability (project_members.role = 'pm'). Org admins create projects;
-- the project's PM (and admins) manage its tasks/members.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Access helpers (SECURITY DEFINER + hardened search_path, like is_org_member) ──
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.org_role(p_org_id) in ('owner', 'admin');
$$;

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.org_role(p_org_id) in ('owner', 'admin', 'finance');
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  );
$$;

create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pm.role::text from public.project_members pm
  where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  limit 1;
$$;

-- Can the caller READ this project's data? Company staff see all; otherwise the
-- caller must be a member of the project.
create or replace function public.can_view_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_staff(p_org_id) or public.is_project_member(p_project_id);
$$;

-- Can the caller MANAGE this project (create tasks/milestones, add members, …)?
-- Org admins manage any project; a project's PM manages that project.
create or replace function public.can_manage_project(p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_admin(p_org_id) or public.project_role(p_project_id) = 'pm';
$$;

-- Parent resolvers for child tables that carry no project_id of their own.
create or replace function public.invoice_project(p_invoice_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.invoices where id = p_invoice_id;
$$;
create or replace function public.request_project(p_request_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.requests where id = p_request_id;
$$;
create or replace function public.task_project(p_task_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.tasks where id = p_task_id;
$$;

-- ── Creator joins their own project (so admins/PMs don't lock themselves out) ──
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.created_by, (select auth.uid()));
begin
  if v_user is not null then
    insert into public.project_members (org_id, project_id, user_id, role)
    values (new.org_id, new.id, v_user, 'pm')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- ─────────────────────────────────────────────────────────────────────────────
-- Policy rewrites. SELECT moves to project-aware visibility everywhere; WRITE is
-- tightened to project managers for delivery tables. Finance write policies stay
-- org-finance-scoped (back-office is company-wide by design); only their SELECT
-- becomes project-aware so clients/members can see their own project's money.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── projects ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using ((select public.can_view_project(id, org_id)));
drop policy if exists projects_write on public.projects;          -- replaced by split policies
create policy projects_insert on public.projects for insert
  with check ((select public.is_org_admin(org_id)));
create policy projects_update on public.projects for update
  using ((select public.can_manage_project(id, org_id)))
  with check ((select public.can_manage_project(id, org_id)));
create policy projects_delete on public.projects for delete
  using ((select public.is_org_admin(org_id)));

-- ── project_members ──
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── milestones ──
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── tasks ──
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check ((select public.can_manage_project(project_id, org_id)));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    assignee_id = (select auth.uid())
    or (select public.can_manage_project(project_id, org_id))
  )
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── task_dependencies (resolve project via the successor task) ──
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(successor_id)))
  );
drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies for all
  using (
    (select public.is_org_admin(org_id))
    or (select public.project_role(public.task_project(successor_id))) = 'pm'
  )
  with check (
    (select public.is_org_admin(org_id))
    or (select public.project_role(public.task_project(successor_id))) = 'pm'
  );

-- ── task_activity (resolve project via the task) ──
drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(task_id)))
  );
drop policy if exists task_activity_insert on public.task_activity;
create policy task_activity_insert on public.task_activity for insert
  with check (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.task_project(task_id)))
  );

-- ── site_reports ──
drop policy if exists site_reports_select on public.site_reports;
create policy site_reports_select on public.site_reports for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists site_reports_insert on public.site_reports;
create policy site_reports_insert on public.site_reports for insert
  with check ((select public.can_view_project(project_id, org_id)) and author_id = (select auth.uid()));
drop policy if exists site_reports_update on public.site_reports;
create policy site_reports_update on public.site_reports for update
  using (author_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists site_reports_delete on public.site_reports;
create policy site_reports_delete on public.site_reports for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── report_media ──
drop policy if exists report_media_select on public.report_media;
create policy report_media_select on public.report_media for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists report_media_insert on public.report_media;
create policy report_media_insert on public.report_media for insert
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists report_media_delete on public.report_media;
create policy report_media_delete on public.report_media for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── budget_lines ──
drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists budget_lines_write on public.budget_lines;
create policy budget_lines_write on public.budget_lines for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── variation_orders ──
drop policy if exists variation_orders_select on public.variation_orders;
create policy variation_orders_select on public.variation_orders for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists variation_orders_write on public.variation_orders;
create policy variation_orders_write on public.variation_orders for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- ── invoices (SELECT project-aware; write stays finance-scoped) ──
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using ((select public.can_view_project(project_id, org_id)));

-- ── invoice_lines (project via invoice) ──
drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── payment_schedule ──
drop policy if exists payment_schedule_select on public.payment_schedule;
create policy payment_schedule_select on public.payment_schedule for select
  using ((select public.can_view_project(project_id, org_id)));

-- ── payments (project via invoice) ──
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── proof_of_payments (project via invoice) ──
drop policy if exists proof_of_payments_select on public.proof_of_payments;
create policy proof_of_payments_select on public.proof_of_payments for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );
drop policy if exists proof_of_payments_insert on public.proof_of_payments;
create policy proof_of_payments_insert on public.proof_of_payments for insert
  with check (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── paynow_transactions (project via invoice) ──
drop policy if exists paynow_transactions_select on public.paynow_transactions;
create policy paynow_transactions_select on public.paynow_transactions for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.invoice_project(invoice_id)))
  );

-- ── requests ──
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select
  using ((select public.can_view_project(project_id, org_id)));
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert
  with check ((select public.can_view_project(project_id, org_id)) and raised_by = (select auth.uid()));
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update
  using (raised_by = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_view_project(project_id, org_id)));
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- ── approvals (project via request) ──
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.is_project_member(public.request_project(request_id)))
  );

-- ── audit_logs (org admins only read the company audit trail) ──
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using ((select public.is_org_admin(org_id)));
