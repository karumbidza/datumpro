-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — daily site diary
--
-- The site record a PM / foreman fills in each day: the weather, how many people
-- were on site, what plant was working, what got delivered, and what work was
-- done — plus photos. One entry per project per day, edited through the day.
--
-- Scope + access follow the project-events model: any member of the project (or
-- org staff) can see and log the diary; the author or a manager (PM / org staff)
-- can edit or remove an entry. Photos are stored in the shared `project-media`
-- bucket under {org}/{project}/diary/{entry}/… — segment [2] is the project, so
-- the existing project-media storage policies already authorise them; only the
-- metadata row lives here.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.site_diary_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  entry_date   date not null default current_date,
  weather      text,                 -- e.g. "Overcast, showers pm"
  temperature  integer,              -- °C, optional
  labour_count integer,              -- people on site
  plant        text,                 -- plant / equipment working on site
  deliveries   text,                 -- materials received
  notes        text,                 -- work done / general remarks
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, org_id),
  unique (project_id, entry_date),   -- one diary entry per project per day
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists site_diary_entries_project_idx
  on public.site_diary_entries (project_id, entry_date desc);

create table if not exists public.site_diary_photos (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null,
  org_id       uuid not null,
  project_id   uuid not null,
  storage_path text not null,        -- key in the project-media bucket
  caption      text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (entry_id, org_id)   references public.site_diary_entries (id, org_id) on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists site_diary_photos_entry_idx on public.site_diary_photos (entry_id, created_at);

alter table public.site_diary_entries enable row level security;
alter table public.site_diary_photos  enable row level security;

-- ── site_diary_entries RLS ──
create policy site_diary_entries_select on public.site_diary_entries for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy site_diary_entries_insert on public.site_diary_entries for insert
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- The author or a manager (PM / org staff) may edit or remove an entry.
create policy site_diary_entries_update on public.site_diary_entries for update
  using (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  )
  with check (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

create policy site_diary_entries_delete on public.site_diary_entries for delete
  using (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── site_diary_photos RLS ──
create policy site_diary_photos_select on public.site_diary_photos for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

-- A project member may attach a photo (they uploaded_by themselves); scope theirs.
create policy site_diary_photos_insert on public.site_diary_photos for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- The uploader or a manager may remove a photo.
create policy site_diary_photos_delete on public.site_diary_photos for delete
  using (
    uploaded_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the diary page.
alter publication supabase_realtime add table public.site_diary_entries;
alter publication supabase_realtime add table public.site_diary_photos;
