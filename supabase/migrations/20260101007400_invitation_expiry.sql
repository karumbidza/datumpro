-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — invitation expiry
--
-- org_invitations tokens were valid forever. Acceptance is already bound to the
-- invited email (a leaked token can't be redeemed by anyone else), but an
-- indefinitely-live link is still a needless standing risk. Give invitations a
-- 7-day life: the accept RPC refuses an expired token, and the preview surfaces
-- an 'expired' status so the accept screen explains it. Admins can re-send a
-- fresh link (which resets the clock).
-- ─────────────────────────────────────────────────────────────────────────────

-- Add nullable, backfill relative to when each invite was created, then lock in
-- the NOT NULL default so new rows expire 7 days out automatically.
alter table public.org_invitations add column if not exists expires_at timestamptz;
update public.org_invitations set expires_at = created_at + interval '7 days' where expires_at is null;
alter table public.org_invitations alter column expires_at set default (now() + interval '7 days');
alter table public.org_invitations alter column expires_at set not null;

-- ── Preview: report 'expired' for a pending-but-past-expiry invite ─────────────
-- Preserves the 5-column shape (incl. member_type, added in 20260101002100) so
-- CREATE OR REPLACE keeps the existing signature + grants; only `status` gains
-- the expiry case.
create or replace function public.invitation_preview(p_token text)
returns table (org_name text, email text, role text, member_type text, status text)
language sql stable security definer set search_path = '' as $$
  select
    o.name,
    i.email,
    i.role::text,
    coalesce(i.member_type, public.type_for_org_role(i.role))::text,
    case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

-- ── Accept: additionally refuse an expired token ──────────────────────────────
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
