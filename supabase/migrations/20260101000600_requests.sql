-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — requests & authorisation
--
-- A request (RFI / purchase / variation / access) flows draft → submitted →
-- approved|rejected through an ordered approval chain materialised from per-org
-- approval policies (who must sign off, above what amount).
--
-- Security-by-design:
--   • Composite (id, org_id) FKs keep the whole chain tenant-consistent.
--   • Approval steps are created ONLY by submit_request() (SECURITY DEFINER) from
--     policy — clients cannot insert arbitrary approval rows.
--   • A user can only record themselves as approver, only for a step matching
--     their org role, and NEVER on their own request (DB trigger — segregation of
--     duties).
--   • Request status is finalised by trigger (all steps approved → approved; any
--     rejected → rejected) so state can't drift.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.request_type      as enum ('rfi', 'purchase', 'variation', 'access');
create type public.request_status    as enum ('draft', 'submitted', 'approved', 'rejected', 'cancelled');
create type public.approval_decision as enum ('pending', 'approved', 'rejected');

create table public.requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  type         public.request_type not null,
  title        text not null,
  description  text,
  amount_cents bigint,                       -- purchase/variation
  status       public.request_status not null default 'draft',
  raised_by    uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint requests_id_org_key unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index requests_project_idx on public.requests (project_id);
create index requests_org_status_idx on public.requests (org_id, status);
create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();

-- Per-org config: which role must approve which request type, above what amount,
-- in what order. An empty match = no approval required (auto-approve).
create table public.approval_policies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  request_type    public.request_type not null,
  min_amount_cents bigint not null default 0,
  approver_role   public.org_role not null,
  step_order      int not null default 1,
  created_at      timestamptz not null default now()
);
create index approval_policies_org_idx on public.approval_policies (org_id, request_type);

create table public.approvals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  request_id    uuid not null,
  step_order    int not null,
  approver_role public.org_role not null,
  approver_id   uuid references auth.users(id) on delete set null,
  decision      public.approval_decision not null default 'pending',
  comment       text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (request_id, org_id) references public.requests (id, org_id) on delete cascade
);
create index approvals_request_idx on public.approvals (request_id);

-- Link an approved variation request to the variation order it produces.
alter table public.variation_orders add column request_id uuid;
alter table public.variation_orders
  add constraint variation_orders_request_fk
  foreign key (request_id, org_id) references public.requests (id, org_id);

-- ── Segregation of duties: requester cannot approve their own request ─────────
create or replace function public.enforce_approval_sod()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_raised_by uuid;
begin
  if new.approver_id is not null then
    select raised_by into v_raised_by from public.requests where id = new.request_id;
    if v_raised_by is not null and v_raised_by = new.approver_id then
      raise exception 'segregation of duties: the requester cannot approve their own request';
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_sod before insert or update on public.approvals
  for each row execute function public.enforce_approval_sod();

-- ── Finalise the request once its chain resolves ─────────────────────────────
create or replace function public.finalize_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pending_count int; rejected_count int;
begin
  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pending_count, rejected_count
  from public.approvals where request_id = new.request_id;

  if rejected_count > 0 then
    update public.requests set status = 'rejected', decided_at = now(), updated_at = now()
      where id = new.request_id and status not in ('rejected', 'cancelled');
  elsif pending_count = 0 then
    update public.requests set status = 'approved', decided_at = now(), updated_at = now()
      where id = new.request_id and status = 'submitted';
  end if;
  return new;
end;
$$;
create trigger approvals_finalize after update on public.approvals
  for each row execute function public.finalize_request();

-- ── Submit a request: materialise its approval chain from policy ─────────────
-- Called by the app via rpc('submit_request', { p_request_id }). SECURITY DEFINER
-- so it can write approval rows that clients themselves cannot.
create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.requests; pol record; step int := 0;
begin
  select * into r from public.requests where id = p_request_id;
  if r.id is null then raise exception 'request not found'; end if;
  if not ((select auth.uid()) = r.raised_by
          or public.org_role(r.org_id) in ('owner', 'admin', 'pm')) then
    raise exception 'not allowed to submit this request';
  end if;
  if r.status <> 'draft' then raise exception 'request is not a draft'; end if;

  for pol in
    select * from public.approval_policies ap
    where ap.org_id = r.org_id and ap.request_type = r.type
      and coalesce(r.amount_cents, 0) >= ap.min_amount_cents
    order by ap.step_order
  loop
    step := step + 1;
    insert into public.approvals (org_id, request_id, step_order, approver_role, decision)
    values (r.org_id, r.id, step, pol.approver_role, 'pending');
  end loop;

  -- No matching policy → nothing to approve → auto-approve.
  -- (CASE over enum literals resolves to text; cast back explicitly because the
  --  function runs with search_path = '' so there's no implicit text→enum cast.)
  update public.requests
    set status = (case when step = 0 then 'approved' else 'submitted' end)::public.request_status,
        decided_at = case when step = 0 then now() else null end,
        updated_at = now()
    where id = r.id;
end;
$$;
grant execute on function public.submit_request(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.requests          enable row level security;
alter table public.approval_policies enable row level security;
alter table public.approvals         enable row level security;

-- requests: members read; raise their own; edit own draft; leads manage.
create policy requests_select on public.requests for select
  using ((select public.is_org_member(org_id)));
create policy requests_insert on public.requests for insert
  with check ((select public.is_org_member(org_id)) and raised_by = (select auth.uid()));
create policy requests_update on public.requests for update
  using (
    (raised_by = (select auth.uid()) and status = 'draft')
    or (select public.org_role(org_id)) in ('owner', 'admin', 'pm')
  )
  with check ((select public.is_org_member(org_id)));
create policy requests_delete on public.requests for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- approval policies: configured by owners/admins; readable by members.
create policy approval_policies_select on public.approval_policies for select
  using ((select public.is_org_member(org_id)));
create policy approval_policies_write on public.approval_policies for all
  using ((select public.org_role(org_id)) in ('owner', 'admin'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin'));

-- approvals: members read; NO client insert (only submit_request / service role);
-- a step can be decided only by someone holding its role (or owner/admin), and the
-- caller can only record THEMSELVES as the approver. The SoD trigger blocks self-
-- approval of one's own request.
create policy approvals_select on public.approvals for select
  using ((select public.is_org_member(org_id)));
create policy approvals_decide on public.approvals for update
  using (
    (select public.org_role(org_id)) = approver_role::text
    or (select public.org_role(org_id)) in ('owner', 'admin')
  )
  with check (approver_id = (select auth.uid()));
