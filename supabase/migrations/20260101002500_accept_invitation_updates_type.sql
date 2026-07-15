-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — re-invite updates an existing member's role & type
--
-- Bug: accept_org_invitation's ON CONFLICT only reactivated the row
-- (`set status = 'active'`) — it never applied the new invitation's role /
-- member_type. So re-inviting an existing member as a different type (e.g. a
-- plain 'member' later re-invited as 'contractor') silently kept the old type.
--
-- Fix: on re-accept, also apply the invitation's role + member_type. Guarded so
-- a re-invite can never downgrade an org owner.
-- ─────────────────────────────────────────────────────────────────────────────

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
