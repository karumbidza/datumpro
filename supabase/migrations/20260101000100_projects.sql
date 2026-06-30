-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — projects, members & milestones
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
  created_at           timestamptz not null default now()
);
create index projects_org_idx on public.projects (org_id);

create table public.project_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.project_role not null default 'contributor',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index project_members_project_idx on public.project_members (project_id);

create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  target_date date,
  status      public.milestone_status not null default 'pending',
  created_at  timestamptz not null default now()
);
create index milestones_project_idx on public.milestones (project_id);

-- ── RLS: tenant isolation by org membership; mutation gated to delivery roles ──
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones      enable row level security;

create policy projects_select on public.projects for select
  using (public.is_org_member(org_id));
create policy projects_write on public.projects for all
  using (public.org_role(org_id) in ('owner', 'admin', 'pm'))
  with check (public.org_role(org_id) in ('owner', 'admin', 'pm'));

create policy project_members_select on public.project_members for select
  using (public.is_org_member(org_id));
create policy project_members_write on public.project_members for all
  using (public.org_role(org_id) in ('owner', 'admin', 'pm'))
  with check (public.org_role(org_id) in ('owner', 'admin', 'pm'));

create policy milestones_select on public.milestones for select
  using (public.is_org_member(org_id));
create policy milestones_write on public.milestones for all
  using (public.org_role(org_id) in ('owner', 'admin', 'pm'))
  with check (public.org_role(org_id) in ('owner', 'admin', 'pm'));
