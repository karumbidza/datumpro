-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — clients (project creation & setup, Phase 1)
--
-- Clients recur across projects; previously a project stored its client as free
-- text (projects.client_name). This introduces a proper org-scoped clients table
-- and links projects to it via a nullable client_id. client_name is KEPT and kept
-- populated so existing readers (portfolio, overview, project page) don't break;
-- the create form will write both going forward. client_contacts / portal invites
-- are deferred to Phase 2.
--
-- Tenancy + RLS mirror the projects pattern: any active org member can read; org
-- admins and PMs can write.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  legal_name  text,
  tin         text,            -- ZIMRA TIN / BP number
  vat_number  text,
  address     text,
  phone       text,
  email       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create unique index clients_org_lower_name_key on public.clients (org_id, lower(name));
create index clients_org_idx on public.clients (org_id);

alter table public.clients enable row level security;

create policy clients_select on public.clients for select
  using ((select public.is_org_member(org_id)));

create policy clients_write on public.clients for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

-- Link projects → clients (nullable so existing rows stay valid; the form requires it).
alter table public.projects add column client_id uuid references public.clients(id) on delete set null;
create index projects_client_idx on public.projects (client_id);

-- Backfill: one client per distinct (org, client_name), then link each project.
-- client_name stays populated for back-compat.
insert into public.clients (org_id, name)
select distinct p.org_id, trim(p.client_name)
from public.projects p
where p.client_name is not null and trim(p.client_name) <> ''
on conflict (org_id, lower(name)) do nothing;

update public.projects p
set client_id = c.id
from public.clients c
where c.org_id = p.org_id
  and lower(c.name) = lower(trim(p.client_name))
  and p.client_name is not null and trim(p.client_name) <> '';
