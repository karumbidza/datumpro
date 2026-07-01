-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task commitments (contractor negotiation) + completion media
--
-- Closes the task loop end-to-end:
--   1. A PM offers a task to a contractor (a project member, role 'contractor').
--   2. The contractor accepts or declines; to accept they respond with a cost,
--      counter timeline, justification (scope of works), payment terms and an
--      attached quote → status 'accepted' or 'counter_proposed'.
--   3. The PM agrees (locks the cost — which becomes the task's Earned-Value
--      weight — and the payment terms) or declines / counters.
--   4. Completion requires media (photos/videos) + a closing report, then PM
--      sign-off.
--
-- Segregation of duties: the person who agrees a commitment cannot be the
-- contractor (DB CHECK). All new tables inherit project-level isolation, and the
-- storage policies are tightened from org-wide to project-scoped to match.
-- ─────────────────────────────────────────────────────────────────────────────

-- New project role. (Only compared as text in policies — never cast to the enum
-- in this migration — so it's safe to add and use policies in the same run.)
alter type public.project_role add value if not exists 'contractor';

-- Task carries the agreed cost (Earned-Value weight) and a closing-out report.
alter table public.tasks add column if not exists agreed_cost_cents bigint;
alter table public.tasks add column if not exists closing_report text;

create type public.commitment_status as enum (
  'offered', 'accepted', 'counter_proposed', 'agreed', 'declined', 'cancelled'
);

-- ── task_commitments — the offer/negotiation record (one per task) ──
create table public.task_commitments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  project_id       uuid not null,
  task_id          uuid not null,
  contractor_id    uuid references auth.users(id) on delete set null,
  status           public.commitment_status not null default 'offered',
  cost_cents       bigint,                              -- contractor's quote
  proposed_start   date,
  proposed_end     date,
  justification    text,                                -- scope of works
  payment_terms    jsonb not null default '{}'::jsonb,  -- {advancePct,retentionPct,milestones:[{label,pct}]}
  quote_path       text,                                -- storage path to quote/invoice
  responded_at     timestamptz,
  agreed_by        uuid references auth.users(id) on delete set null,
  agreed_cost_cents bigint,
  decided_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (task_id),
  -- Segregation of duties: whoever agrees can't be the contractor.
  constraint task_commitments_sod check (agreed_by is null or agreed_by <> contractor_id),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_commitments_task_idx       on public.task_commitments (task_id);
create index task_commitments_contractor_idx on public.task_commitments (contractor_id);

create trigger task_commitments_touch before update on public.task_commitments
  for each row execute function public.touch_updated_at();

-- ── task_media — completion evidence, quotes, progress photos ──
create table public.task_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  task_id      uuid not null,
  kind         text not null default 'photo',       -- photo | video | document
  purpose      text not null default 'completion',  -- completion | quote | progress
  storage_path text not null,
  caption      text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_media_task_idx on public.task_media (task_id);

-- ── RLS ──
alter table public.task_commitments enable row level security;
alter table public.task_media       enable row level security;

-- Commitments: everyone on the project can see; the PM/admin offers & decides;
-- the contractor (and the PM) can update during negotiation.
create policy task_commitments_select on public.task_commitments for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_commitments_insert on public.task_commitments for insert
  with check ((select public.can_manage_project(project_id, org_id)) and created_by = (select auth.uid()));
create policy task_commitments_update on public.task_commitments for update
  using (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)))
  with check (contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)));
create policy task_commitments_delete on public.task_commitments for delete
  using ((select public.can_manage_project(project_id, org_id)));

-- Media: project members can see & upload their own; managers or the uploader delete.
create policy task_media_select on public.task_media for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_media_insert on public.task_media for insert
  with check ((select public.can_view_project(project_id, org_id)) and uploaded_by = (select auth.uid()));
create policy task_media_delete on public.task_media for delete
  using (uploaded_by = (select auth.uid()) or (select public.can_manage_project(project_id, org_id)));

-- ── Tighten storage to project-level isolation ──
-- Path is {org_id}/{project_id}/…/{file}; segment [2] is the project. Previously
-- gated by org membership only (any org member could read any project's media);
-- now gated by project access so a contractor on project A can't touch B's files.
drop policy if exists "project-media read" on storage.objects;
create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.can_view_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );

drop policy if exists "project-media upload" on storage.objects;
create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (select public.can_view_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );

drop policy if exists "project-media delete" on storage.objects;
create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.can_manage_project(
      public.safe_uuid((storage.foldername(name))[2]),
      public.safe_uuid((storage.foldername(name))[1])
    ))
  );
