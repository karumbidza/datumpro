-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — member types + project-role lockdown
--
-- Two tightenings, decided with the team:
--  1. A person's TYPE is pinned at invitation (Admin / PM / Finance / Staff /
--     Contractor / Client / Viewer), not inferred later at project-assignment.
--     The type sets the org role AND constrains which project roles they can
--     ever hold — a Contractor can only ever be a project contractor/contributor,
--     a Client only client/viewer. Enforced in the DB (trigger), not just the UI.
--  2. No self-made project PMs. A project PM who is not an org admin/PM can no
--     longer promote anyone to project-PM (that seat carries buy-side money
--     powers). Granting project-role 'pm' now requires org admin or org PM.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Member type enum (a presentation/constraint layer over org_role) ──────────
create type public.member_type as enum (
  'owner', 'admin', 'pm', 'finance', 'staff', 'contractor', 'client', 'viewer'
);

-- Map a member_type to its org_role (capabilities keep flowing through org_role).
create or replace function public.org_role_for_type(p_type public.member_type)
returns public.org_role language sql immutable set search_path = '' as $$
  select case p_type
    when 'owner'      then 'owner'::public.org_role
    when 'admin'      then 'admin'::public.org_role
    when 'pm'         then 'pm'::public.org_role
    when 'finance'    then 'finance'::public.org_role
    when 'staff'      then 'member'::public.org_role
    when 'contractor' then 'member'::public.org_role
    when 'client'     then 'viewer'::public.org_role
    when 'viewer'     then 'viewer'::public.org_role
  end;
$$;

-- Best-effort reverse map for backfilling existing rows / legacy invitations.
create or replace function public.type_for_org_role(p_role public.org_role)
returns public.member_type language sql immutable set search_path = '' as $$
  select case p_role
    when 'owner'   then 'owner'::public.member_type
    when 'admin'   then 'admin'::public.member_type
    when 'pm'      then 'pm'::public.member_type
    when 'finance' then 'finance'::public.member_type
    when 'member'  then 'staff'::public.member_type
    when 'viewer'  then 'viewer'::public.member_type
  end;
$$;

-- ── org_members.member_type (backfill from existing role, then NOT NULL) ──────
alter table public.org_members add column member_type public.member_type;
update public.org_members set member_type = public.type_for_org_role(role) where member_type is null;
alter table public.org_members alter column member_type set not null;
alter table public.org_members alter column member_type set default 'staff';

-- ── org_invitations.member_type (new invites set it; NULL = legacy → derive) ──
alter table public.org_invitations add column member_type public.member_type;

-- ── Owner membership on org creation carries the owner type ───────────────────
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    insert into public.org_members (org_id, user_id, role, member_type, status)
    values (new.id, (select auth.uid()), 'owner', 'owner', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

-- ── Accept sets role AND member_type from the invitation (deriving for legacy) ─
create or replace function public.accept_org_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv    public.org_invitations;
  uid    uuid := (select auth.uid());
  uemail text;
  mtype  public.member_type;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into inv from public.org_invitations where token = p_token;
  if not found then
    raise exception 'invitation not found';
  end if;
  if inv.status = 'revoked' then
    raise exception 'invitation revoked';
  end if;

  select lower(email) into uemail from auth.users where id = uid;
  if uemail is distinct from lower(inv.email) then
    raise exception 'invitation was sent to a different email address';
  end if;

  mtype := coalesce(inv.member_type, public.type_for_org_role(inv.role));

  insert into public.org_members (org_id, user_id, role, member_type, status)
  values (inv.org_id, uid, public.org_role_for_type(mtype), mtype, 'active')
  on conflict (org_id, user_id) do update set status = 'active';

  update public.org_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = uid
    where id = inv.id and status = 'pending';

  return inv.org_id;
end;
$$;

-- Surface the type on the accept screen too. DROP first — CREATE OR REPLACE
-- cannot change a function's return signature (we're adding a column).
drop function if exists public.invitation_preview(text);
create or replace function public.invitation_preview(p_token text)
returns table (org_name text, email text, role text, member_type text, status text)
language sql stable security definer set search_path = '' as $$
  select o.name, i.email, i.role::text,
         coalesce(i.member_type, public.type_for_org_role(i.role))::text, i.status
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

-- ── (2) Lock project-PM: granting project-role 'pm' needs org admin or org PM ─
drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check (
    (select public.can_manage_project(project_id, org_id))
    and (
      role <> 'pm'
      or (select public.is_org_admin(org_id))
      or (select public.org_role(org_id)) = 'pm'
    )
  );

-- ── (1) A member's TYPE constrains the project roles they may hold ────────────
create or replace function public.enforce_project_role_for_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare mt public.member_type;
begin
  select member_type into mt from public.org_members
    where org_id = new.org_id and user_id = new.user_id;
  if mt is null then
    return new; -- not an org member yet; other FKs/policies handle that
  end if;
  if mt = 'contractor' and new.role not in ('contractor', 'contributor') then
    raise exception 'A contractor can only be assigned as a project contractor or contributor';
  end if;
  if mt = 'client' and new.role not in ('client', 'viewer') then
    raise exception 'A client can only be assigned as a project client or viewer';
  end if;
  if mt in ('finance', 'viewer') and new.role = 'pm' then
    raise exception 'This member type cannot be a project PM';
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_type_guard on public.project_members;
create trigger project_members_type_guard
  before insert or update on public.project_members
  for each row execute function public.enforce_project_role_for_type();
