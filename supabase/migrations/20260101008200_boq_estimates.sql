-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Estimates: Bills of Quantities (Phase 1)
--
-- A BOQ is an ORG-SCOPED library object, independent of any project — the same
-- shape as clients: staff build and price it, then a project can be created from
-- an approved one. This is the estimating half of the product; the tender/award
-- half (packages, sealed contractor bids) builds on top of it in a later phase.
--
-- Shape (matches the builder UI): boq → boq_section → boq_item.
--   • boq_section is a user-named group (Preliminaries, Substructure, Earthworks…)
--     — plain sections, not a fixed classification tree, so the same builder serves
--     any industry. NRM / trade classification is an optional later layer.
--   • boq_item is the priced leaf: a metric unit, a quantity, and the internal
--     ESTIMATE rate. budget_rate_cents is PRIVATE to staff — at tender time a
--     contractor fills their own rate elsewhere; this figure is never exposed.
--
-- Tenancy + RLS mirror clients/projects exactly: every row carries org_id and
-- references its parent by the COMPOSITE (id, org_id) key, so a child's org_id is
-- forced to equal its parent's — no cross-tenant rows, even with the service key.
-- Any active org member reads; org admins and PMs write.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.boq_status    as enum ('draft', 'approved', 'archived');
create type public.boq_item_type as enum ('measured', 'provisional_sum', 'prime_cost');

-- ── The bill (library object) ────────────────────────────────────────────────
create table public.boqs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  -- Client is optional at estimate time (a template has none). Keep the free-text
  -- name for quick entry and link to clients when known — same dual approach as
  -- projects.client_name / client_id.
  client_id   uuid references public.clients(id) on delete set null,
  client_name text,
  industry    text,                         -- sector tag (any industry); drives templates/benchmarks later
  reference   text,                          -- e.g. DP-2026-014
  location    text,
  boq_date    date,
  currency    text not null default 'USD',   -- ISO 4217; amounts are stored in that currency's minor unit
  status      public.boq_status not null default 'draft',
  is_template boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- target for child composite FKs (id is already unique; this names it explicitly)
  unique (id, org_id)
);
create index boqs_org_idx    on public.boqs (org_id);
create index boqs_client_idx on public.boqs (client_id);

-- ── Sections (user-named groups within a bill) ───────────────────────────────
create table public.boq_sections (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  boq_id     uuid not null,
  name       text not null default 'Untitled section',
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  constraint boq_sections_id_org_key unique (id, org_id),
  foreign key (boq_id, org_id) references public.boqs (id, org_id) on delete cascade
);
create index boq_sections_boq_idx on public.boq_sections (boq_id);

-- ── Items (priced leaves) ────────────────────────────────────────────────────
create table public.boq_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  section_id        uuid not null,
  description       text not null default '',
  -- Units are hard-coded to the metric (SI) standard, enforced at the DB so a bill
  -- can't drift to imperial. Null = not yet set. Widen deliberately via migration.
  uom               text check (uom is null or uom in (
                      'mm','m','km','m²','m³','L','kL','g','kg','t',
                      'nr','item','set','pair','sum','%','hr','day','week','month')),
  qty               numeric(18,4) not null default 0,
  budget_rate_cents bigint not null default 0,   -- internal ESTIMATE rate, minor units — PRIVATE to staff
  item_type         public.boq_item_type not null default 'measured',
  position          integer not null default 0,
  -- Convenience roll-up so section/bill totals don't have to recompute qty×rate.
  amount_cents      bigint generated always as (round(qty * budget_rate_cents)::bigint) stored,
  created_at        timestamptz not null default now(),
  constraint boq_items_id_org_key unique (id, org_id),
  foreign key (section_id, org_id) references public.boq_sections (id, org_id) on delete cascade
);
create index boq_items_section_idx on public.boq_items (section_id);

-- ── Row-Level Security ───────────────────────────────────────────────────────
-- Any active org member reads the estimate library; org admins and PMs build and
-- price it (identical to clients). Sections/items carry org_id, so the same
-- predicate scopes them without walking to the parent.
alter table public.boqs         enable row level security;
alter table public.boq_sections enable row level security;
alter table public.boq_items    enable row level security;

create policy boqs_select on public.boqs for select
  using ((select public.is_org_member(org_id)));
create policy boqs_write on public.boqs for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

create policy boq_sections_select on public.boq_sections for select
  using ((select public.is_org_member(org_id)));
create policy boq_sections_write on public.boq_sections for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

create policy boq_items_select on public.boq_items for select
  using ((select public.is_org_member(org_id)));
create policy boq_items_write on public.boq_items for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');
