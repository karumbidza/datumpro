-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task engine
--
-- The unit of assigned work, with the full SLA / blocker / dependency / photo
-- sign-off logic (see docs/FUNCTIONAL_SPEC.md). SLA *computation* (clock, deadline
-- crediting, escalation) lives in @datumpro/shared + Inngest jobs; this migration
-- owns the schema + the integrity rules that must hold no matter the caller:
--   • circular dependencies are rejected (trigger);
--   • only a PM/Admin/Owner (or the system) may approve a task to DONE (trigger);
--   • cross-tenant references impossible (composite FKs).
-- ─────────────────────────────────────────────────────────────────────────────

create type public.task_status     as enum ('todo', 'in_progress', 'submitted', 'blocked', 'done');
create type public.task_priority   as enum ('low', 'medium', 'high', 'urgent');
create type public.task_sla_status as enum
  ('on_track', 'at_risk', 'pending_signoff', 'blocked', 'breached', 'resolved_on_time', 'resolved_late');

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  project_id          uuid not null,
  milestone_id        uuid,
  budget_line_id      uuid,                       -- cost roll-up (budget vs actual)
  title               text not null,
  description         text,
  status              public.task_status   not null default 'todo',
  priority            public.task_priority not null default 'medium',
  assignee_id         uuid references auth.users(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  -- scheduling
  planned_start_date  date,
  planned_end_date    date,
  due_date            date,
  actual_start_date   timestamptz,
  actual_end_date     timestamptz,
  baseline_start_date date,                       -- frozen at creation for variance
  baseline_end_date   date,
  -- SLA
  sla_status          public.task_sla_status not null default 'on_track',
  sla_clock_started_at timestamptz,
  sla_clock_paused_at  timestamptz,
  sla_total_paused_ms  bigint not null default 0,
  sla_breach_count     int not null default 0,
  -- blocker
  blocker_raised_at    timestamptz,
  blocker_raised_by    uuid references auth.users(id) on delete set null,
  blocker_description  text,
  blocker_resolved_at  timestamptz,
  blocker_resolved_by  uuid references auth.users(id) on delete set null,
  -- sign-off (mandatory photo by default)
  requires_photo_on_complete boolean not null default true,
  submitted_at         timestamptz,
  submitted_by         uuid references auth.users(id) on delete set null,
  completion_notes     text,
  completion_photos    jsonb not null default '[]'::jsonb,  -- array of storage paths
  declaration_confirmed boolean not null default false,
  approved_at          timestamptz,
  approved_by          uuid references auth.users(id) on delete set null,
  rejected_at          timestamptz,
  rejected_by          uuid references auth.users(id) on delete set null,
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint tasks_id_org_key unique (id, org_id),
  foreign key (project_id, org_id)     references public.projects (id, org_id)     on delete cascade,
  foreign key (milestone_id, org_id)   references public.milestones (id, org_id),
  foreign key (budget_line_id, org_id) references public.budget_lines (id, org_id)
);
create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_org_idx            on public.tasks (org_id);
create index tasks_assignee_idx       on public.tasks (assignee_id);
create index tasks_due_idx            on public.tasks (due_date);
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ── Dependencies (predecessor → successor, with lag) ─────────────────────────
create table public.task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  predecessor_id uuid not null,
  successor_id   uuid not null,
  lag_days       int not null default 0,
  created_at     timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id),
  foreign key (predecessor_id, org_id) references public.tasks (id, org_id) on delete cascade,
  foreign key (successor_id, org_id)   references public.tasks (id, org_id) on delete cascade
);
create index task_dependencies_successor_idx   on public.task_dependencies (successor_id);
create index task_dependencies_predecessor_idx on public.task_dependencies (predecessor_id);

-- Reject a dependency that would create a cycle: if the successor can already
-- reach the predecessor through existing edges, the new edge closes a loop.
create or replace function public.check_task_dep_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    with recursive reach as (
      select new.successor_id as node
      union
      select d.successor_id from public.task_dependencies d
      join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = new.predecessor_id
  ) then
    raise exception 'circular task dependency';
  end if;
  return new;
end;
$$;
create trigger task_dependencies_cycle before insert on public.task_dependencies
  for each row execute function public.check_task_dep_cycle();

-- ── Task activity (timeline / audit) ─────────────────────────────────────────
create table public.task_activity (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  task_id    uuid not null,
  user_id    uuid references auth.users(id) on delete set null,
  type       text not null,                 -- 'created' | 'assigned' | 'status' | 'blocker' | ...
  message    text not null,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);
create index task_activity_task_idx on public.task_activity (task_id, created_at desc);

-- ── Sign-off authority: only a lead (or the system) may approve to DONE ──────
create or replace function public.guard_task_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    -- auth.uid() is null for system/service contexts (Inngest, webhooks) → allowed.
    if (select auth.uid()) is not null
       and public.org_role(new.org_id) not in ('owner', 'admin', 'pm') then
      raise exception 'only a project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$$;
create trigger tasks_signoff_guard before update on public.tasks
  for each row execute function public.guard_task_signoff();

-- ── Progress billing link: a scheduled draw can be tied to a task ────────────
alter table public.payment_schedule add column task_id uuid;
alter table public.payment_schedule
  add constraint payment_schedule_task_fk
  foreign key (task_id, org_id) references public.tasks (id, org_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.tasks             enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_activity     enable row level security;

-- tasks: members read; PM/admin/owner create + delete; the assignee may update
-- their own task (start / blocker / submit) and leads may update any. The sign-off
-- guard above stops a non-lead from setting DONE.
create policy tasks_select on public.tasks for select
  using ((select public.is_org_member(org_id)));
create policy tasks_insert on public.tasks for insert
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));
create policy tasks_update on public.tasks for update
  using (
    assignee_id = (select auth.uid())
    or (select public.org_role(org_id)) in ('owner', 'admin', 'pm')
  )
  with check ((select public.is_org_member(org_id)));
create policy tasks_delete on public.tasks for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

-- dependencies + activity: members read; leads manage dependencies; activity is
-- insert-only by any member (the app writes timeline entries).
create policy task_dependencies_select on public.task_dependencies for select
  using ((select public.is_org_member(org_id)));
create policy task_dependencies_write on public.task_dependencies for all
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy task_activity_select on public.task_activity for select
  using ((select public.is_org_member(org_id)));
create policy task_activity_insert on public.task_activity for insert
  with check ((select public.is_org_member(org_id)));
