-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — snagging / defects register
--
-- A snag is a defect raised against a project (optionally a task/location),
-- assigned to a contractor, with a severity and a lifecycle:
--   open → fixed (contractor) → verified (PM)   — the good outcome
--   open → reopened (PM rejects the fix) → …     — round trip
--   open → charged (PM deducts from retention)   — the money outcome
--
-- The register ties into the defects-liability period already built for
-- retention: when a contractor won't put a defect right, the PM can charge the
-- repair against their retention. That reuses the immutable retention_deductions
-- ledger via the existing record_retention_deduction RPC — this migration only
-- records the resulting deduction id on the snag (one-directional link), so the
-- ledger and its SECURITY DEFINER RPC stay untouched.
--
-- Scope + access follow the site-diary / project-events model: any member of the
-- project (or org staff) can see and raise a snag; the raiser, the assignee, or a
-- manager (PM / org staff) can act on it. Photos reuse the shared project-media
-- bucket under {org}/{project}/snags/{snag}/… — segment [2] is the project, so the
-- existing project-media storage policies already authorise them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.snags (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  project_id             uuid not null,
  number                 int  not null,                 -- per-project running ref (#14)
  task_id                uuid,                           -- optional link to a task
  title                  text not null,
  description            text,
  location               text,                           -- e.g. "Unit 3 bathroom"
  severity               text not null default 'major'
                           check (severity in ('minor', 'major', 'critical')),
  status                 text not null default 'open'
                           check (status in ('open', 'fixed', 'verified', 'reopened', 'charged')),
  assignee_id            uuid references auth.users(id) on delete set null,
  due_date               date,
  fixed_at               timestamptz,
  verified_at            timestamptz,
  retention_deduction_id uuid references public.retention_deductions(id) on delete set null,
  raised_by              uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, org_id),
  unique (project_id, number),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete set null
);
create index if not exists snags_project_idx on public.snags (project_id, created_at desc);
create index if not exists snags_assignee_idx on public.snags (assignee_id);

-- Per-project running number. An advisory lock on the project serialises
-- concurrent inserts so two snags never claim the same ref.
create or replace function public.snags_assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from public.snags where project_id = new.project_id;
  end if;
  return new;
end $$;

create trigger snags_assign_number_trg before insert on public.snags
  for each row execute function public.snags_assign_number();

create table if not exists public.snag_photos (
  id           uuid primary key default gen_random_uuid(),
  snag_id      uuid not null,
  org_id       uuid not null,
  project_id   uuid not null,
  storage_path text not null,       -- key in the project-media bucket
  caption      text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (snag_id, org_id)    references public.snags (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists snag_photos_snag_idx on public.snag_photos (snag_id, created_at);

alter table public.snags       enable row level security;
alter table public.snag_photos enable row level security;

-- ── snags RLS ──
create policy snags_select on public.snags for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy snags_insert on public.snags for insert
  with check (
    raised_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- The raiser, the assigned contractor, or a manager (PM / org staff) may act on a
-- snag. Which transitions each may make is enforced in the server actions.
create policy snags_update on public.snags for update
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

create policy snags_delete on public.snags for delete
  using (
    raised_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── snag_photos RLS ──
create policy snag_photos_select on public.snag_photos for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy snag_photos_insert on public.snag_photos for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

create policy snag_photos_delete on public.snag_photos for delete
  using (
    uploaded_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the register.
alter publication supabase_realtime add table public.snags;
alter publication supabase_realtime add table public.snag_photos;
