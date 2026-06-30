-- DatumPro — consolidated schema bootstrap (generated from supabase/migrations/*).
-- Paste this whole file into Supabase Studio → SQL Editor → Run.
-- Idempotent-ish: intended for a FRESH project. Re-running will error on
-- existing objects (that's expected).


-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000000_init_tenancy.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — identity & tenancy
--
-- Multi-tenancy is enforced in the DATABASE via Row-Level Security: every
-- tenant-owned row carries `org_id`, and policies allow access only to members of
-- that org. App code can't forget to scope a query — Postgres does it.
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
  created_at timestamptz not null default now()
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
create index org_members_user_idx on public.org_members (user_id);
create index org_members_org_idx  on public.org_members (org_id);

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

-- ── Access helper functions ──────────────────────────────────────────────────
-- SECURITY DEFINER so they read org_members WITHOUT triggering RLS — this is what
-- prevents infinite recursion when a policy on org_members calls is_org_member().
create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.org_role(p_org_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role::text from public.org_members m
  where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
  limit 1;
$$;

-- True if the current user shares any org with `p_user_id` (for visibility of
-- co-members' profiles).
create or replace function public.shares_org(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on them.org_id = me.org_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = p_user_id and them.status = 'active'
  );
$$;

-- ── Triggers: bootstrap profile on signup, owner membership on org creation ───
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
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
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into public.org_members (org_id, user_id, role, status)
    values (new.id, auth.uid(), 'owner', 'active')
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
  using (id = auth.uid() or public.shares_org(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations: members read; any authed user may create (trigger makes them
-- owner); owners/admins update; owners delete
create policy organizations_select on public.organizations for select
  using (public.is_org_member(id));
create policy organizations_insert on public.organizations for insert
  with check (auth.uid() is not null);
create policy organizations_update on public.organizations for update
  using (public.org_role(id) in ('owner', 'admin'))
  with check (public.org_role(id) in ('owner', 'admin'));
create policy organizations_delete on public.organizations for delete
  using (public.org_role(id) = 'owner');

-- org_members: members see co-members; owners/admins manage
create policy org_members_select on public.org_members for select
  using (public.is_org_member(org_id));
create policy org_members_write on public.org_members for all
  using (public.org_role(org_id) in ('owner', 'admin'))
  with check (public.org_role(org_id) in ('owner', 'admin'));

-- invitations: owners/admins only
create policy invitations_manage on public.invitations for all
  using (public.org_role(org_id) in ('owner', 'admin'))
  with check (public.org_role(org_id) in ('owner', 'admin'));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000100_projects.sql
-- ═══════════════════════════════════════════════════════════════════════
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
  using (public.is_org_member(org_id));

-- ═══════════════════════════════════════════════════════════════════════
-- migration: 20260101000300_monitoring.sql
-- ═══════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — field monitoring: site reports + media
--
-- These are the offline-first tables (captured on site, synced via PowerSync).
-- RLS lets any active org member CREATE their own report/media, while edits/
-- deletes are restricted to the author or delivery leads (pm/admin/owner).
-- ─────────────────────────────────────────────────────────────────────────────

create type public.report_status as enum ('draft', 'submitted');
create type public.media_type    as enum ('image', 'video');

create table public.site_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete set null,
  report_date  date not null default current_date,
  progress_pct smallint not null default 0 check (progress_pct between 0 and 100),
  narrative    text,
  weather      text,
  gps_lat      double precision,
  gps_lng      double precision,
  status       public.report_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index site_reports_project_idx on public.site_reports (project_id, report_date desc);
create index site_reports_org_idx     on public.site_reports (org_id);

create table public.report_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  report_id    uuid not null references public.site_reports(id) on delete cascade,
  storage_path text not null,           -- {org_id}/{project_id}/{report_id}/{file}
  media_type   public.media_type not null,
  captured_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index report_media_report_idx on public.report_media (report_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
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

-- site_reports: members read everything in their org; authors create their own;
-- author or delivery leads edit; delivery leads delete.
create policy site_reports_select on public.site_reports for select
  using (public.is_org_member(org_id));
create policy site_reports_insert on public.site_reports for insert
  with check (public.is_org_member(org_id) and author_id = auth.uid());
create policy site_reports_update on public.site_reports for update
  using (author_id = auth.uid() or public.org_role(org_id) in ('owner', 'admin', 'pm'))
  with check (public.is_org_member(org_id));
create policy site_reports_delete on public.site_reports for delete
  using (public.org_role(org_id) in ('owner', 'admin', 'pm'));

-- report_media: members read; members attach; delivery leads delete.
create policy report_media_select on public.report_media for select
  using (public.is_org_member(org_id));
create policy report_media_insert on public.report_media for insert
  with check (public.is_org_member(org_id));
create policy report_media_delete on public.report_media for delete
  using (public.org_role(org_id) in ('owner', 'admin', 'pm'));

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

create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and public.org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'pm')
  );
