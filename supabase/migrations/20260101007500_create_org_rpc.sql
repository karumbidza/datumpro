-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — atomic organisation creation RPC
--
-- Bug: createOrg did `insert into organizations ... returning id`. RETURNING makes
-- Postgres apply the SELECT policy (organizations_select = is_org_member(id)) to
-- the new row, but the creator's owner-membership is added by the on_org_created
-- AFTER trigger — so at RETURNING time they're not yet a member and the whole
-- statement fails with "new row violates row-level security policy". Result: org
-- creation never succeeded from the wizard.
--
-- Fix: do it in one SECURITY DEFINER call that inserts the org AND the owner
-- membership and returns the id as a scalar (no client-side RETURNING under RLS).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_organization(
  p_name                text,
  p_legal_name          text default null,
  p_country             text default null,
  p_sector              text default null,
  p_registration_number text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := (select auth.uid());
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations
    (name, legal_name, country, sector, registration_number, onboarding_completed_at)
  values
    (p_name,
     nullif(p_legal_name, ''),
     nullif(p_country, ''),
     nullif(p_sector, ''),
     nullif(p_registration_number, ''),
     now())
  returning id into new_id;

  -- Creator becomes owner. on_org_created also does this from auth.uid(); keep an
  -- explicit, idempotent insert so org creation never silently depends on the
  -- trigger staying enabled.
  insert into public.org_members (org_id, user_id, role, status)
  values (new_id, uid, 'owner', 'active')
  on conflict (org_id, user_id) do nothing;

  return new_id;
end;
$$;

-- Only signed-in users; never anon.
revoke all on function public.create_organization(text, text, text, text, text) from public;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;
