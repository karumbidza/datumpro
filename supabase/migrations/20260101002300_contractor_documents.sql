-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — contractor compliance documents (tax clearances, company docs)
--
-- A contractor files compliance documents (tax clearance, company registration,
-- insurance, bank confirmation …), optionally with issue/expiry dates. Org staff
-- (owner/admin/finance) review them: submitted → verified (or rejected).
--
-- Confidentiality (as discussed for financial data): a document is visible only
-- to the owning contractor and org staff — never to other contractors, clients,
-- PMs, or viewers. Files live in the private project-media bucket under a
-- compliance path and are only handed out as signed URLs to those roles.
--
-- Money/compliance safety: a BEFORE UPDATE trigger enforces that a contractor can
-- only edit their own STILL-SUBMITTED document and can never self-verify; only
-- staff move a document to verified/rejected.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.contractor_doc_type as enum (
  'tax_clearance', 'company_registration', 'insurance', 'bank_confirmation', 'other'
);
create type public.contractor_doc_status as enum ('submitted', 'verified', 'rejected');

create table public.contractor_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contractor_id uuid not null references auth.users(id) on delete cascade,
  doc_type      public.contractor_doc_type not null default 'other',
  title         text,
  storage_path  text not null,
  file_name     text,
  issued_date   date,
  expiry_date   date,
  status        public.contractor_doc_status not null default 'submitted',
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index cd_org_idx        on public.contractor_documents (org_id, status);
create index cd_contractor_idx on public.contractor_documents (contractor_id);
create index cd_expiry_idx      on public.contractor_documents (expiry_date);

alter table public.contractor_documents enable row level security;

-- Read: the owning contractor, or org staff. Nobody else.
create policy cd_select on public.contractor_documents for select
  using (
    contractor_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
  );

-- Insert: a contractor files their OWN document, starting 'submitted'.
create policy cd_insert on public.contractor_documents for insert
  with check (
    contractor_id = (select auth.uid())
    and status = 'submitted'
    and (select public.is_org_member(org_id))
  );

-- Update: owner (while pending) or staff (verification). Trigger enforces details.
create policy cd_update on public.contractor_documents for update
  using (
    contractor_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
  )
  with check (
    contractor_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
  );

-- Delete: owner or staff.
create policy cd_delete on public.contractor_documents for delete
  using (
    contractor_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
  );

-- ── Authority enforcement (belt and braces over RLS) ─────────────────────────
create or replace function public.enforce_contractor_doc_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  is_staff boolean;
begin
  is_staff := public.is_org_staff(NEW.org_id);  -- exists() → never NULL
  if not is_staff then
    -- Contractor: only their own still-submitted doc; never self-verify.
    if OLD.status <> 'submitted' then
      raise exception 'This document has been reviewed and can no longer be edited';
    end if;
    if NEW.status <> OLD.status
       or NEW.reviewed_by is distinct from OLD.reviewed_by
       or NEW.contractor_id <> OLD.contractor_id then
      raise exception 'Only an admin can verify a document';
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger enforce_contractor_doc_update
  before update on public.contractor_documents
  for each row execute function public.enforce_contractor_doc_update();
