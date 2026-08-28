-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — company contact details + terms acceptance at onboarding
--
-- The setup wizard now collects a company contact email/phone and requires the
-- owner to accept the Terms & Privacy policy. Store both on the organisation:
--   • contact_email / contact_phone — optional company contact channels
--   • terms_accepted_at             — the legal record of acceptance (when + that
--                                     it happened; the accepting user is the owner
--                                     member created in the same call)
--
-- Email verification (a 6-digit OTP to the owner's login email) and the terms
-- checkbox are enforced in the server action before this RPC runs; the RPC just
-- persists the timestamp so the acceptance is on record. Keeping the new RPC
-- params optional (defaults) means the org-creation-cap regression test, which
-- calls create_organization('Cap Org N') positionally, keeps working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists contact_email     text,
  add column if not exists contact_phone     text,
  add column if not exists terms_accepted_at timestamptz;

-- New signature (adds contact_email, contact_phone, terms_accepted). The old
-- 5-arg overload must be dropped first so only one function exists.
drop function if exists public.create_organization(text, text, text, text, text);

create or replace function public.create_organization(
  p_name                text,
  p_legal_name          text default null,
  p_country             text default null,
  p_sector              text default null,
  p_registration_number text default null,
  p_contact_email       text default null,
  p_contact_phone       text default null,
  p_terms_accepted      boolean default false
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
    (name, legal_name, country, sector, registration_number,
     contact_email, contact_phone, terms_accepted_at, onboarding_completed_at)
  values
    (p_name,
     nullif(p_legal_name, ''),
     nullif(p_country, ''),
     nullif(p_sector, ''),
     nullif(p_registration_number, ''),
     nullif(p_contact_email, ''),
     nullif(p_contact_phone, ''),
     case when p_terms_accepted then now() else null end,
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
revoke all on function public.create_organization(text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.create_organization(text, text, text, text, text, text, text, boolean) to authenticated;
