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
