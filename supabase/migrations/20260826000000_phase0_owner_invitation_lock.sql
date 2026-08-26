-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 0A: eliminate Admin → Owner privilege escalation
--
-- Threat closed: an Administrator (or any compromised/malicious account with the
-- `admin` org role) could become Owner by calling Supabase directly, via EITHER
-- of two database-level paths the UI did not (could not) protect:
--
--   (1) INVITATION PATH — insert an `org_invitations` row whose role/member_type
--       resolves to owner (RLS only checked `is_org_admin(org_id)`, never the
--       role column), then accept it. `accept_org_invitation` only guarded against
--       *downgrading* an existing owner (`where org_members.role <> 'owner'`), not
--       against *upgrading* to owner.
--   (2) DIRECT MEMBERSHIP PATH — `UPDATE org_members SET role='owner'` on their own
--       row. `org_members_write`'s WITH CHECK only verifies the *actor* is
--       owner/admin, never the resulting role.
--
-- Fix (all DB-enforced; UI/API are not trusted):
--   • CHECK constraints forbid owner in `org_invitations` (defence in depth).
--   • `accept_org_invitation` hardened to reject any owner-resolving invitation.
--   • A trigger on `org_members` makes "becoming owner" impossible except through
--     the legitimate bootstrap (first owner at org creation) or the dedicated
--     `grant_owner()` RPC. This single trigger closes BOTH paths and any future
--     one, for every caller including the service role (triggers are not bypassed
--     by BYPASSRLS).
--   • `grant_owner()` — the ONLY sanctioned way to mint an owner: owner-only,
--     same-org, MFA-aware, audited, no client-supplied authority.
--
-- Non-destructive: no legitimate membership data is rewritten; existing owners
-- stay owners. A pre-check aborts loudly (never silently deletes) if any pending
-- owner invitation already exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Pre-flight: surface any pre-existing owner invitations (do NOT delete) ──
-- If this raises, an operator must review/revoke those rows before deploying;
-- we refuse to silently destroy production data.
do $$
declare n_role int; n_type int;
begin
  select count(*) into n_role from public.org_invitations where role = 'owner';
  select count(*) into n_type from public.org_invitations
    where member_type = 'owner';
  if (n_role + n_type) > 0 then
    raise exception
      'Phase 0A abort: % owner-role and % owner-type invitation(s) exist. Review and revoke them, then re-run. (Data left intact.)',
      n_role, n_type;
  end if;
end $$;

-- ── 1. Defence-in-depth CHECK constraints on org_invitations ──────────────────
-- A CHECK alone is not sufficient (it cannot distinguish a sanctioned owner grant
-- from an attack) — that distinction lives in the trigger + grant_owner() below —
-- but it makes the ordinary invitation path incapable of ever expressing owner.
alter table public.org_invitations
  add constraint org_invitations_no_owner_role
  check (role <> 'owner');

alter table public.org_invitations
  add constraint org_invitations_no_owner_type
  check (member_type is distinct from 'owner');

-- ── 2. Harden accept_org_invitation: never resolve to owner ───────────────────
-- Faithful reproduction of the live version (20260101007400 — the latest, which
-- includes the expiry check) with only an explicit owner rejection added.
-- Behaviour is otherwise byte-for-byte identical, so no legitimate acceptance
-- flow changes.
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
  if inv.status = 'pending' and inv.expires_at < now() then
    raise exception 'invitation expired';
  end if;

  select lower(email) into uemail from auth.users where id = uid;
  if uemail is distinct from lower(inv.email) then
    raise exception 'invitation was sent to a different email address';
  end if;

  mtype := coalesce(inv.member_type, public.type_for_org_role(inv.role));

  -- Defence in depth: even a pre-existing / smuggled owner invitation cannot be
  -- redeemed into owner. Owner is granted only via grant_owner().
  if mtype = 'owner' or public.org_role_for_type(mtype) = 'owner' then
    raise exception 'owner status cannot be granted via invitation; use grant_owner()'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.org_members (org_id, user_id, role, member_type, status)
  values (inv.org_id, uid, public.org_role_for_type(mtype), mtype, 'active')
  on conflict (org_id, user_id) do update
    set status      = 'active',
        role        = excluded.role,
        member_type = excluded.member_type
    where org_members.role <> 'owner';  -- never downgrade an owner via re-invite

  update public.org_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = uid
    where id = inv.id and status = 'pending';

  return inv.org_id;
end;
$$;

-- ── 3. The owner-assignment guard (the real boundary) ─────────────────────────
-- Fires on every INSERT/UPDATE of org_members. It only reacts when a row is
-- *newly becoming* owner (role or member_type), so benign updates to existing
-- owner rows (e.g. reactivation) are unaffected.
--
-- A "newly becoming owner" write is permitted ONLY when either:
--   (a) the sanctioned-grant flag for THIS org is set in the current transaction
--       (set exclusively by grant_owner()), OR
--   (b) it is an INSERT that establishes the org's FIRST owner (bootstrap by
--       handle_new_org / create_organization) — i.e. no *other* owner exists yet.
-- Everything else — admin self-UPDATE to owner, accepting an owner invitation,
-- direct service-role writes — is rejected.
create or replace function public.guard_owner_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  becoming_owner boolean;
  other_owner    boolean;
begin
  becoming_owner :=
       (tg_op = 'INSERT' and (new.role = 'owner' or new.member_type = 'owner'))
    or (tg_op = 'UPDATE' and (
           (new.role        = 'owner' and old.role        is distinct from 'owner')
        or (new.member_type = 'owner' and old.member_type is distinct from 'owner')));

  if not becoming_owner then
    return new;
  end if;

  -- (a) sanctioned grant for this exact org, this transaction
  if current_setting('app.allow_owner_grant', true) is not distinct from new.org_id::text then
    return new;
  end if;

  -- (b) bootstrap: INSERT of the org's first owner (no other owner exists)
  if tg_op = 'INSERT' then
    select exists (
      select 1 from public.org_members m
      where m.org_id = new.org_id
        and m.role = 'owner'
        and m.user_id <> new.user_id
    ) into other_owner;
    if not other_owner then
      return new;
    end if;
  end if;

  raise exception 'owner status may only be assigned via org creation or grant_owner()'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.guard_owner_assignment() from public;

drop trigger if exists org_members_owner_guard on public.org_members;
create trigger org_members_owner_guard
  before insert or update on public.org_members
  for each row execute function public.guard_owner_assignment();

-- ── 4. grant_owner(): the sole sanctioned owner-minting operation ─────────────
-- Owner-only, same-org, MFA-aware (consistent with the app's existing
-- session_meets_org_mfa gate), audited. The actor is derived from the session,
-- never from arguments. Adds a co-owner (does not demote the existing owner).
create or replace function public.grant_owner(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor      uuid := (select auth.uid());
  actor_role public.org_role;
  target     public.org_members;
begin
  if actor is null then
    raise exception 'not authenticated';
  end if;

  -- Actor must be an ACTIVE owner of THIS org (derived from the session).
  select role into actor_role from public.org_members
    where org_id = p_org_id and user_id = actor and status = 'active';
  if actor_role is distinct from 'owner' then
    raise exception 'only an owner may grant owner status'
      using errcode = 'insufficient_privilege';
  end if;

  -- Strong auth where the org mandates it (no lockout for non-MFA orgs).
  if not public.session_meets_org_mfa(p_org_id) then
    raise exception 'owner grant requires multi-factor authentication';
  end if;

  -- Target must already be an active member of the same org.
  select * into target from public.org_members
    where org_id = p_org_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'target must be an active member of this organisation';
  end if;
  if target.role = 'owner' then
    return;  -- idempotent: already an owner
  end if;

  -- Authorise the owner assignment for THIS org, THIS transaction only.
  perform set_config('app.allow_owner_grant', p_org_id::text, true);

  update public.org_members
    set role = 'owner', member_type = 'owner'
    where org_id = p_org_id and user_id = p_user_id;

  -- Close the window immediately so nothing else in this tx can mint an owner.
  perform set_config('app.allow_owner_grant', '', true);

  -- Audit (grant_owner is SECURITY DEFINER and owns the write; audit_logs has no
  -- INSERT policy by design, so this definer insert is the sanctioned writer).
  insert into public.audit_logs
    (org_id, actor_id, entity_type, entity_id, action, before, after)
  values
    (p_org_id, actor, 'org_member', target.id, 'member.owner_granted',
     jsonb_build_object('role', target.role::text, 'member_type', target.member_type::text),
     jsonb_build_object('role', 'owner', 'member_type', 'owner'));
end;
$$;

revoke all on function public.grant_owner(uuid, uuid) from public;
grant execute on function public.grant_owner(uuid, uuid) to authenticated;
