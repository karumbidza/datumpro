-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ sealed tender (Phase 1: schema)
-- A tender puts one BOQ out to bid. Bidders (existing contractor members or new
-- companies invited by email) price the SAME bill online; prices stay hidden from
-- staff until unsealed. Tenancy mirrors the BOQ tables: every row carries org_id
-- and references its parent by the composite (id, org_id) key.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.tender_status as enum ('draft', 'open', 'closed', 'awarded', 'cancelled');
create type public.bidder_status as enum ('invited', 'viewing', 'submitted', 'withdrawn');

create table public.boq_tenders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  boq_id            uuid not null,
  title             text not null,
  close_at          timestamptz,
  status            public.tender_status not null default 'draft',
  unsealed_at       timestamptz,
  awarded_bidder_id uuid,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint boq_tenders_id_org_key unique (id, org_id),
  foreign key (boq_id, org_id) references public.boqs (id, org_id) on delete cascade
);
create index boq_tenders_org_idx on public.boq_tenders (org_id);
create index boq_tenders_boq_idx on public.boq_tenders (boq_id);

create table public.boq_bidders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  tender_id     uuid not null,
  company_name  text not null,
  contact_email text not null,
  user_id       uuid references auth.users(id) on delete set null,
  invite_token  text not null unique,
  status        public.bidder_status not null default 'invited',
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  constraint boq_bidders_id_org_key unique (id, org_id),
  foreign key (tender_id, org_id) references public.boq_tenders (id, org_id) on delete cascade
);
create unique index boq_bidders_one_per_email
  on public.boq_bidders (tender_id, lower(contact_email));
create index boq_bidders_user_idx on public.boq_bidders (user_id);

alter table public.boq_tenders
  add constraint boq_tenders_awarded_fk
  foreign key (awarded_bidder_id) references public.boq_bidders(id) on delete set null;

create table public.boq_bid_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  bidder_id    uuid not null,
  boq_item_id  uuid not null,
  rate_cents   bigint not null default 0,
  no_bid       boolean not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint boq_bid_items_id_org_key unique (id, org_id),
  constraint boq_bid_items_one_per_line unique (bidder_id, boq_item_id),
  foreign key (bidder_id, org_id)   references public.boq_bidders (id, org_id) on delete cascade,
  foreign key (boq_item_id, org_id) references public.boq_items   (id, org_id) on delete cascade
);
create index boq_bid_items_bidder_idx on public.boq_bid_items (bidder_id);
