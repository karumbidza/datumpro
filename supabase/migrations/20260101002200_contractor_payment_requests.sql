-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — contractor payment requests (buy-side money loop)
--
-- A contractor asks to be paid, either:
--   • against a pre-generated draw (payment_schedule: advance/progress/…), or
--   • as an ad-hoc invoice not tied to a scheduled draw.
-- They attach an invoice document. Lifecycle:
--     requested → approved → paid        (or → rejected)
-- The admin/PM reviews, marks paid, and attaches a proof-of-payment (POP) the
-- contractor can download.
--
-- Cost confidentiality (as with quotes/draws): a request is visible only to org
-- staff (owner/admin/finance), the project's PM, and the owning contractor — never
-- to other contractors, clients, or viewers. Invoice/POP files live in the private
-- project-media bucket and are only ever handed out as signed URLs to those roles.
--
-- Money safety: transitions and role authority are enforced by a trigger in
-- addition to RLS, so a contractor can never move their own request to paid.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.payment_request_status as enum ('requested', 'approved', 'paid', 'rejected');

create table public.contractor_payment_requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null,
  task_id        uuid,
  -- Optional link to a scheduled draw; kept soft (set null) so deleting a draw
  -- doesn't erase the payment history.
  schedule_id    uuid references public.payment_schedule(id) on delete set null,
  contractor_id  uuid not null references auth.users(id) on delete cascade,
  title          text   not null,
  amount_cents   bigint not null check (amount_cents > 0),
  invoice_path   text,          -- uploaded invoice doc (project-media)
  invoice_name   text,
  status         public.payment_request_status not null default 'requested',
  note           text,          -- contractor's note to the reviewer
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,          -- manager's approve/reject note
  paid_at        timestamptz,
  paid_reference text,
  paid_by        uuid references auth.users(id) on delete set null,
  pop_path       text,          -- proof-of-payment doc the manager shares back
  pop_name       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (task_id, org_id)    references public.tasks (id, org_id)
);
create index cpr_project_idx    on public.contractor_payment_requests (project_id);
create index cpr_contractor_idx on public.contractor_payment_requests (contractor_id);
create index cpr_status_idx     on public.contractor_payment_requests (org_id, status);

alter table public.contractor_payment_requests enable row level security;

-- ── Read: cost-confidential ──────────────────────────────────────────────────
create policy cpr_select on public.contractor_payment_requests for select
  using (
    (select public.is_org_staff(org_id))                 -- owner/admin/finance
    or (select public.project_role(project_id)) = 'pm'   -- the project's PM
    or contractor_id = (select auth.uid())               -- the owning contractor
  );

-- ── Insert: a contractor raises their OWN request, starting 'requested' ───────
create policy cpr_insert on public.contractor_payment_requests for insert
  with check (
    contractor_id = (select auth.uid())
    and status = 'requested'
    and (select public.is_org_member(org_id))
  );

-- ── Update: owning contractor (edit while pending) or managers (lifecycle).
--    The trigger below is what actually enforces who may do what. ──────────────
create policy cpr_update on public.contractor_payment_requests for update
  using (
    (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
    or contractor_id = (select auth.uid())
  )
  with check (
    (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
    or contractor_id = (select auth.uid())
  );

-- ── Delete: contractor may withdraw a still-pending request; managers may too ─
create policy cpr_delete on public.contractor_payment_requests for delete
  using (
    (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
    or (contractor_id = (select auth.uid()) and status = 'requested')
  );

-- ── Authority + transition enforcement (money: belt and braces over RLS) ──────
create or replace function public.enforce_payment_request_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  is_manager boolean;
begin
  -- `project_role() = 'pm'` is NULL when the user has no project role; without the
  -- coalesce, `is_manager` would be NULL and `IF NOT NULL … ELSE` would fall into
  -- the manager branch — letting a contractor pay themselves. Force a real boolean.
  is_manager := public.is_org_staff(NEW.org_id)
                or coalesce(public.project_role(NEW.project_id) = 'pm', false);

  if not is_manager then
    -- Contractor: may only tweak their own still-pending request; never move money.
    if OLD.status <> 'requested' then
      raise exception 'This request can no longer be edited';
    end if;
    if NEW.status <> OLD.status
       or NEW.reviewed_by is distinct from OLD.reviewed_by
       or NEW.paid_at    is distinct from OLD.paid_at
       or NEW.pop_path   is distinct from OLD.pop_path
       or NEW.contractor_id <> OLD.contractor_id then
      raise exception 'Only a manager can review or pay a request';
    end if;
  else
    -- Manager: terminal states are final.
    if OLD.status in ('paid', 'rejected') then
      raise exception 'This request is already %', OLD.status;
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger enforce_payment_request_update
  before update on public.contractor_payment_requests
  for each row execute function public.enforce_payment_request_update();
