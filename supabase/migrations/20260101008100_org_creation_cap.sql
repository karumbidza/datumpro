-- ─────────────────────────────────────────────────────────────────────────────
-- Security assessment F7 — cap organisations created per user
--
-- organizations_insert allows any authenticated user to create an org (the
-- on_org_created trigger then makes them owner). Uncapped, one account can spin
-- up unlimited tenants — resource-exhaustion / abuse vector. Enforce a per-user
-- ceiling in a BEFORE INSERT trigger so it covers BOTH the create_organization
-- RPC and any direct insert. System/service provisioning (auth.uid() is null,
-- e.g. the service role) is not capped.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_org_creation_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := (select auth.uid());
  owned int;
  cap   constant int := 10;
begin
  -- Not a user-initiated insert (service role / background job) → no cap.
  if uid is null then
    return new;
  end if;

  select count(*) into owned
    from public.org_members m
   where m.user_id = uid and m.role = 'owner' and m.status = 'active';

  if owned >= cap then
    raise exception 'You have reached the maximum of % organisations for one account. Contact support if you need more.', cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_creation_cap on public.organizations;
create trigger organizations_creation_cap
  before insert on public.organizations
  for each row execute function public.enforce_org_creation_cap();
