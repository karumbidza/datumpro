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
