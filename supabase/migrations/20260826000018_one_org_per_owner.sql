-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — one organisation per owner
--
-- Product rule: an account may CREATE (own) at most one organisation. The same
-- account can still be INVITED into any number of other organisations as a member
-- (admin / finance / pm / member / viewer / contractor) — invitations grant
-- non-owner roles only (guard_owner_assignment / accept_org_invitation enforce
-- that), so being a member elsewhere never counts against this ceiling.
--
-- enforce_org_creation_cap already gates every organisations INSERT (RPC and any
-- direct insert) by counting the caller's active owner memberships. Lower the cap
-- from 10 to 1. The trigger binding is unchanged — replacing the function keeps
-- the existing organizations_creation_cap trigger pointed at it. Service/system
-- inserts (auth.uid() is null) stay uncapped.
-- ─────────────────────────────────────────────────────────────────────────────

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
