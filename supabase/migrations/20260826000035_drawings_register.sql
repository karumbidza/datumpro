-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — drawings register
--
-- A controlled catalogue of a project's drawings: each drawing has a number,
-- title and discipline, and a history of revisions. A revision carries a label
-- (A, B, C…), a status (for review / for construction / superseded / as-built),
-- an issue date and the PDF itself. Issuing a new revision supersedes the prior
-- ones (handled in the server action) so the register always shows the current
-- sheet, with the full history kept.
--
-- It's a controlled register: any project member (or org staff) can see and
-- download drawings; only a manager (PM / org staff) can add or revise them.
-- PDFs live in the shared project-media bucket under {org}/{project}/drawings/…
-- — segment [2] is the project, so the existing storage policies authorise them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.drawings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  number     text not null,                 -- e.g. "S-101"
  title      text not null,
  discipline text not null default 'architectural'
               check (discipline in ('architectural', 'structural', 'civil', 'mechanical',
                                      'electrical', 'plumbing', 'landscape', 'survey', 'other')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (project_id, number),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists drawings_project_idx on public.drawings (project_id, number);

create table if not exists public.drawing_revisions (
  id           uuid primary key default gen_random_uuid(),
  drawing_id   uuid not null,
  org_id       uuid not null,
  project_id   uuid not null,
  revision     text not null,               -- label: A, B, C, 1, 2…
  status       text not null default 'for_review'
                 check (status in ('for_review', 'for_construction', 'for_information',
                                   'superseded', 'as_built')),
  issue_date   date,
  storage_path text,                         -- the PDF, in the project-media bucket
  filename     text,
  notes        text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (drawing_id, revision),
  foreign key (drawing_id, org_id) references public.drawings (id, org_id) on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists drawing_revisions_drawing_idx on public.drawing_revisions (drawing_id, created_at desc);

alter table public.drawings          enable row level security;
alter table public.drawing_revisions enable row level security;

-- ── drawings RLS: members read; managers write ──
create policy drawings_select on public.drawings for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy drawings_insert on public.drawings for insert
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_org_staff(org_id))
      or coalesce((select public.project_role(project_id)) = 'pm', false)
    )
  );

create policy drawings_update on public.drawings for update
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

create policy drawings_delete on public.drawings for delete
  using (
    (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── drawing_revisions RLS: members read; managers write ──
create policy drawing_revisions_select on public.drawing_revisions for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy drawing_revisions_insert on public.drawing_revisions for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select public.is_org_staff(org_id))
      or coalesce((select public.project_role(project_id)) = 'pm', false)
    )
  );

create policy drawing_revisions_update on public.drawing_revisions for update
  using (
    uploaded_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  )
  with check (
    uploaded_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

create policy drawing_revisions_delete on public.drawing_revisions for delete
  using (
    (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the register.
alter publication supabase_realtime add table public.drawings;
alter publication supabase_realtime add table public.drawing_revisions;
