-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — RFIs (Requests for Information)
--
-- A formal question raised on a project (usually contractor → PM / consultant)
-- about a design or spec ambiguity, tracked to a written answer:
--   open → answered (responder records the answer) → closed (raiser/PM accepts)
--   open → reopened (the answer didn't settle it) → …
--
-- Each RFI has a per-project number, a priority and a response-due date, can
-- reference a drawing from the register, and carries attachments. Scope + access
-- follow the snagging model: any member of the project (or org staff) can raise
-- and see RFIs; the raiser, the assigned responder, or a manager (PM / org staff)
-- can act. Attachments reuse the project-media bucket under {org}/{project}/rfis/…
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rfis (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  number       int  not null,                  -- per-project running ref (RFI #12)
  subject      text not null,
  detail       text,
  discipline   text not null default 'architectural'
                 check (discipline in ('architectural', 'structural', 'civil', 'mechanical',
                                       'electrical', 'plumbing', 'landscape', 'survey', 'other')),
  priority     text not null default 'medium'
                 check (priority in ('low', 'medium', 'high', 'urgent')),
  status       text not null default 'open'
                 check (status in ('open', 'answered', 'closed', 'reopened')),
  drawing_id   uuid,                            -- optional reference into the register
  assignee_id  uuid references auth.users(id) on delete set null,  -- the responder
  due_date     date,
  answer       text,
  answered_at  timestamptz,
  answered_by  uuid references auth.users(id) on delete set null,
  raised_by    uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, org_id),
  unique (project_id, number),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (drawing_id, org_id) references public.drawings (id, org_id) on delete set null
);
create index if not exists rfis_project_idx  on public.rfis (project_id, created_at desc);
create index if not exists rfis_assignee_idx on public.rfis (assignee_id);

-- Per-project running number, serialised on the project so two RFIs never collide.
create or replace function public.rfis_assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from public.rfis where project_id = new.project_id;
  end if;
  return new;
end $$;

create trigger rfis_assign_number_trg before insert on public.rfis
  for each row execute function public.rfis_assign_number();

create table if not exists public.rfi_attachments (
  id           uuid primary key default gen_random_uuid(),
  rfi_id       uuid not null,
  org_id       uuid not null,
  project_id   uuid not null,
  storage_path text not null,
  filename     text,
  caption      text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (rfi_id, org_id)     references public.rfis (id, org_id)     on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists rfi_attachments_rfi_idx on public.rfi_attachments (rfi_id, created_at);

alter table public.rfis            enable row level security;
alter table public.rfi_attachments enable row level security;

-- ── rfis RLS ──
create policy rfis_select on public.rfis for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy rfis_insert on public.rfis for insert
  with check (
    raised_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- The raiser, the assigned responder, or a manager (PM / org staff) may act on it.
create policy rfis_update on public.rfis for update
  using (
    raised_by = (select auth.uid())
    or assignee_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  )
  with check (
    raised_by = (select auth.uid())
    or assignee_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

create policy rfis_delete on public.rfis for delete
  using (
    raised_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── rfi_attachments RLS ──
create policy rfi_attachments_select on public.rfi_attachments for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy rfi_attachments_insert on public.rfi_attachments for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

create policy rfi_attachments_delete on public.rfi_attachments for delete
  using (
    uploaded_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the RFI log.
alter publication supabase_realtime add table public.rfis;
alter publication supabase_realtime add table public.rfi_attachments;
