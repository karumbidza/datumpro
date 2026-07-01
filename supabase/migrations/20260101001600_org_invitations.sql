-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — organisation invitations
--
-- How a new person joins an org: an admin creates an invitation (email + role +
-- random token) and DatumPro emails them a link. Accepting adds them to
-- org_members. Admins manage invitations under normal RLS; acceptance goes
-- through a SECURITY DEFINER RPC because the invitee is not yet a member and so
-- can't see the row under RLS. The RPC binds acceptance to the invited email so
-- a leaked token can't be redeemed by someone else.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  token       text not null unique,
  invited_by  uuid references auth.users(id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index org_invitations_org_idx on public.org_invitations (org_id);
-- At most one live invitation per email per org (case-insensitive).
create unique index org_invitations_one_pending
  on public.org_invitations (org_id, lower(email)) where status = 'pending';

alter table public.org_invitations enable row level security;

-- Admins of the org manage its invitations end to end. Invitees never touch this
-- table directly — they go through accept_org_invitation().
create policy org_invitations_admin on public.org_invitations for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

-- ── Read an invitation by token (for the accept screen), bypassing RLS but
--    exposing only what the screen needs. Anyone with the token may preview it. ──
create or replace function public.invitation_preview(p_token text)
returns table (org_name text, email text, role text, status text)
language sql stable security definer set search_path = '' as $$
  select o.name, i.email, i.role::text, i.status
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

-- ── Accept: the signed-in user joins the org named by the token, but only if the
--    invited email matches their own. Idempotent on re-accept. Returns org_id. ──
create or replace function public.accept_org_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv   public.org_invitations;
  uid   uuid := (select auth.uid());
  uemail text;
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

  insert into public.org_members (org_id, user_id, role, status)
  values (inv.org_id, uid, inv.role, 'active')
  on conflict (org_id, user_id) do update set status = 'active';

  update public.org_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = uid
    where id = inv.id and status = 'pending';

  return inv.org_id;
end;
$$;
