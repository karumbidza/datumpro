-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — enterprise / government access requests
--
-- Public lead capture for the "for government & enterprise" lane. The table is
-- RLS-locked (no public/authenticated read or write); only the service role
-- (Mission Control admin API) reads it, and a SECURITY DEFINER RPC performs the
-- single allowed public write — an INSERT of a new request. DatumPro reviews and
-- provisions the org manually with the existing create-org + invite flows.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.enterprise_requests (
  id             uuid primary key default gen_random_uuid(),
  org_name       text not null,
  buyer_type     text,               -- government / enterprise / ngo / corporate / other
  country        text,
  contact_name   text,
  contact_email  text not null,
  team_size      text,
  needs          text,               -- freeform: SSO? residency? timelines?
  status         text not null default 'pending'
                   check (status in ('pending', 'reviewing', 'approved', 'rejected')),
  created_at     timestamptz not null default now(),
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_org_id uuid references public.organizations(id) on delete set null
);
create index enterprise_requests_created_idx on public.enterprise_requests (created_at desc);

-- RLS on, NO policies: only the service role (RLS-bypassing) can read/write, and
-- the SECURITY DEFINER RPC below inserts. There is no public/anon read path.
alter table public.enterprise_requests enable row level security;

-- Public insert path for the unauthenticated request form. SECURITY DEFINER runs
-- as the function owner, bypassing RLS; it can ONLY insert a request (never read
-- existing ones). Mirrors the invitation_preview pattern.
create or replace function public.submit_enterprise_request(
  p_org_name      text,
  p_buyer_type    text,
  p_country       text,
  p_contact_name  text,
  p_contact_email text,
  p_team_size     text,
  p_needs         text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  req_id uuid;
begin
  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'organisation name is required';
  end if;
  if coalesce(trim(p_contact_email), '') = '' or position('@' in p_contact_email) = 0 then
    raise exception 'a valid contact email is required';
  end if;

  insert into public.enterprise_requests
    (org_name, buyer_type, country, contact_name, contact_email, team_size, needs)
  values
    (trim(p_org_name), nullif(trim(p_buyer_type), ''), nullif(trim(p_country), ''),
     nullif(trim(p_contact_name), ''), trim(p_contact_email),
     nullif(trim(p_team_size), ''), nullif(trim(p_needs), ''))
  returning id into req_id;

  return req_id;
end;
$$;
