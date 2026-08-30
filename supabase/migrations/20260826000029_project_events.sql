-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project events (meetings, site visits) + attendees
--
-- Schedule a meeting or site visit from the project chat: a title, a type, when
-- and where, who's coming, and — the point for construction — the meeting notes,
-- captured against the event and managed on the calendar. Events surface on the
-- project calendar alongside tasks and to-dos.
--
-- Scope + access follow the project-chat model: any member of the project (or org
-- staff) can see and schedule events; the organiser, an attendee, or a manager can
-- update (attendees keep the minutes); the organiser or a manager can remove one.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid   not null references public.organizations(id) on delete cascade,
  project_id      uuid   not null,
  conversation_id uuid,          -- the chat it was scheduled from (soft link)
  title           text   not null,
  detail          text,          -- agenda / what it's about
  kind            text   not null default 'meeting'
                    check (kind in ('meeting', 'site_visit', 'inspection', 'other')),
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,
  notes           text,          -- minutes captured during/after the event
  status          text   not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists project_events_project_idx on public.project_events (project_id, starts_at);

create table if not exists public.event_attendees (
  event_id   uuid not null,
  org_id     uuid not null,
  project_id uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, org_id) references public.project_events (id, org_id) on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists event_attendees_user_idx on public.event_attendees (user_id);

alter table public.project_events enable row level security;
alter table public.event_attendees enable row level security;

-- ── project_events RLS ──
create policy project_events_select on public.project_events for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy project_events_insert on public.project_events for insert
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- Organiser, a manager, or an attendee (to keep the minutes) may update.
create policy project_events_update on public.project_events for update
  using (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
    or exists (
      select 1 from public.event_attendees a
      where a.event_id = id and a.user_id = (select auth.uid())
    )
  )
  with check (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
    or exists (
      select 1 from public.event_attendees a
      where a.event_id = id and a.user_id = (select auth.uid())
    )
  );

create policy project_events_delete on public.project_events for delete
  using (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── event_attendees RLS ──
create policy event_attendees_select on public.event_attendees for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

-- A project member may add attendees (they added_by themselves); scope must be theirs.
create policy event_attendees_insert on public.event_attendees for insert
  with check (
    added_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- Whoever added the attendee, a manager, or the attendee themselves may remove it.
create policy event_attendees_delete on public.event_attendees for delete
  using (
    added_by = (select auth.uid())
    or user_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the calendar / chat.
alter publication supabase_realtime add table public.project_events;
alter publication supabase_realtime add table public.event_attendees;
