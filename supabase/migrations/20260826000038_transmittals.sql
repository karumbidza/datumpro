-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — transmittals register
--
-- A transmittal is the formal record that a set of drawings (specific revisions
-- from the drawings register) was issued to a recipient on a date, for a purpose
-- (for construction / for review / …), by a method. Each transmittal has a
-- per-project number and a list of items; each item snapshots the drawing's
-- number, revision and title at issue time, so the record stays a stable
-- point-in-time document even if the drawing is later revised or removed.
--
-- It's a controlled register like drawings: any project member (or org staff)
-- can see transmittals; only a manager (PM / org staff) issues or edits them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.transmittals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null,
  number            int  not null,                 -- per-project running ref (TR-007)
  recipient         text not null,                 -- company / person the docs went to
  recipient_user_id uuid references auth.users(id) on delete set null,  -- optional, if a member
  purpose           text not null default 'for_construction'
                      check (purpose in ('for_construction', 'for_review', 'for_approval',
                                         'for_information', 'for_record')),
  method            text not null default 'email'
                      check (method in ('email', 'hand', 'courier', 'portal', 'other')),
  issued_date       date not null default current_date,
  notes             text,
  issued_by         uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, org_id),
  unique (project_id, number),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists transmittals_project_idx on public.transmittals (project_id, issued_date desc);

-- Per-project running number, serialised on the project so two never collide.
create or replace function public.transmittals_assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from public.transmittals where project_id = new.project_id;
  end if;
  return new;
end $$;

create trigger transmittals_assign_number_trg before insert on public.transmittals
  for each row execute function public.transmittals_assign_number();

create table if not exists public.transmittal_items (
  id                  uuid primary key default gen_random_uuid(),
  transmittal_id      uuid not null,
  org_id              uuid not null,
  project_id          uuid not null,
  drawing_revision_id uuid references public.drawing_revisions(id) on delete set null,  -- soft link
  drawing_number      text not null,   -- snapshot at issue
  revision            text,            -- snapshot
  title               text,            -- snapshot
  created_at          timestamptz not null default now(),
  foreign key (transmittal_id, org_id) references public.transmittals (id, org_id) on delete cascade,
  foreign key (project_id, org_id)     references public.projects (id, org_id)     on delete cascade
);
create index if not exists transmittal_items_transmittal_idx on public.transmittal_items (transmittal_id, created_at);

alter table public.transmittals      enable row level security;
alter table public.transmittal_items enable row level security;

-- ── transmittals RLS: members read; managers issue/edit ──
create policy transmittals_select on public.transmittals for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy transmittals_insert on public.transmittals for insert
  with check (
    issued_by = (select auth.uid())
    and (
      (select public.is_org_staff(org_id))
      or coalesce((select public.project_role(project_id)) = 'pm', false)
    )
  );

create policy transmittals_update on public.transmittals for update
  using (
    issued_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  )
  with check (
    issued_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

create policy transmittals_delete on public.transmittals for delete
  using (
    (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- ── transmittal_items RLS: members read; managers write ──
create policy transmittal_items_select on public.transmittal_items for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

create policy transmittal_items_insert on public.transmittal_items for insert
  with check (
    (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

create policy transmittal_items_delete on public.transmittal_items for delete
  using (
    (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the register.
alter publication supabase_realtime add table public.transmittals;
alter publication supabase_realtime add table public.transmittal_items;
