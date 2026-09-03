-- Staff belong to a single organisation and cannot switch.
--
-- A contractor legitimately works for several companies, so they may hold many
-- org memberships. Internal staff are the opposite: dedicated to one org. We pin
-- them at the two chokepoints where a second membership is created:
--   1. accept_org_invitation — the only path an invited membership is created.
--   2. enforce_org_creation_cap — the organizations-INSERT gate (owning a second
--      org would also give a staff account two orgs to switch between).
-- A staff membership is exclusive in BOTH directions: a staff invite is rejected
-- when the user already belongs to another org, and any org join/creation is
-- rejected when the user is already staff somewhere. Re-accepting into the SAME
-- org (a reactivation) is unaffected.

-- ── 1. accept_org_invitation: reproduce current body (20260826000000) + guard ──
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

  -- Staff are single-org. Block if this is a staff invite and the user already
  -- belongs to another org, OR if the user is already staff elsewhere and is
  -- joining a new org. Re-accepting into the same org is fine.
  if exists (
    select 1 from public.org_members m
    where m.user_id = uid
      and m.status = 'active'
      and m.org_id <> inv.org_id
      and (mtype = 'staff' or m.member_type = 'staff')
  ) then
    raise exception 'Staff accounts belong to a single organisation and cannot join another.'
      using errcode = 'check_violation';
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

-- ── 2. enforce_org_creation_cap: reproduce current body (20260826000018) + guard ─
create or replace function public.enforce_org_creation_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := (select auth.uid());
  owned int;
  cap   constant int := 1;
begin
  -- Not a user-initiated insert (service role / background job) → no cap.
  if uid is null then
    return new;
  end if;

  -- A staff account is dedicated to one org and may not create (own) another.
  if exists (
    select 1 from public.org_members m
    where m.user_id = uid and m.status = 'active' and m.member_type = 'staff'
  ) then
    raise exception 'Staff accounts belong to a single organisation and cannot create another.'
      using errcode = 'check_violation';
  end if;

  select count(*) into owned
    from public.org_members m
   where m.user_id = uid and m.role = 'owner' and m.status = 'active';

  if owned >= cap then
    raise exception 'This account already owns an organisation. You can be invited to others as a member, but each account can create only one.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
