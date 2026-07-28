-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — verified email domains + auto-join
--
-- An org claims a domain and proves control via a DNS TXT record. Only ONE org
-- may hold a VERIFIED domain (partial unique index). New users whose email domain
-- matches a verified domain are offered a one-click join at the lowest role. The
-- domain→org mapping is never publicly readable; two SECURITY DEFINER RPCs expose
-- only "is the current user's own domain claimable?" and "join it".
-- ─────────────────────────────────────────────────────────────────────────────

create table public.org_domains (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  domain             text not null,          -- bare, lowercased, e.g. 'acme.com'
  verification_token text not null,
  verified_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (org_id, domain)                     -- no duplicate claim within an org
);
-- Exactly one org may VERIFY a given domain, globally.
create unique index org_domains_verified_domain_uidx
  on public.org_domains (domain) where verified_at is not null;
create index org_domains_org_idx on public.org_domains (org_id);

alter table public.org_domains enable row level security;

-- Admins manage their own org's domains. No public read — the auto-join RPCs below
-- are the only path for a non-admin to learn a domain is claimed (and only their own).
create policy org_domains_select on public.org_domains for select
  using ((select public.is_org_admin(org_id)));
create policy org_domains_insert on public.org_domains for insert
  with check ((select public.is_org_admin(org_id)));
create policy org_domains_update on public.org_domains for update
  using ((select public.is_org_admin(org_id)));
create policy org_domains_delete on public.org_domains for delete
  using ((select public.is_org_admin(org_id)));

-- "Is the CURRENT user's email domain a verified domain of some org they're not in?"
-- Returns at most one org (id + name). Never exposes other users' or other domains'
-- mappings — it only ever looks up the caller's own email domain.
create or replace function public.find_joinable_org()
returns table (org_id uuid, org_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  uemail  text;
  udomain text;
begin
  select email into uemail from auth.users where id = (select auth.uid());
  if uemail is null then return; end if;
  udomain := lower(split_part(uemail, '@', 2));
  if udomain = '' then return; end if;

  return query
    select o.id, o.name
    from public.org_domains d
    join public.organizations o on o.id = d.org_id
    where d.verified_at is not null
      and lower(d.domain) = udomain
      and not exists (
        select 1 from public.org_members m
        where m.org_id = o.id and m.user_id = (select auth.uid())
      )
    limit 1;
end;
$$;

-- Join an org by a verified domain match. Re-checks the caller's email domain
-- server-side (never trusts the client) and adds them at the lowest role.
create or replace function public.join_org_by_domain(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := (select auth.uid());
  uemail  text;
  udomain text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select email into uemail from auth.users where id = uid;
  udomain := lower(split_part(coalesce(uemail, ''), '@', 2));

  if not exists (
    select 1 from public.org_domains d
    where d.org_id = p_org_id and d.verified_at is not null and lower(d.domain) = udomain
  ) then
    raise exception 'your email domain is not a verified domain for this organisation';
  end if;

  insert into public.org_members (org_id, user_id, role, member_type, status)
  values (p_org_id, uid, 'member', 'staff', 'active')
  on conflict (org_id, user_id) do nothing;

  return p_org_id;
end;
$$;
