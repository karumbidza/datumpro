-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — task acceptance + subtask plan (contractor's to-do list)
--
-- Flow: a PM assigns a task to a contractor → the task is "pending" acceptance.
-- The contractor accepts (or rejects with a reason). After accepting they build
-- a subtask plan (a to-do list with timelines). Ticking subtasks off drives the
-- task's % completion (equal weight: done ÷ total); a task can only be submitted
-- for approval once every subtask is done. Task % rolls up to project %.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.task_acceptance as enum ('pending', 'accepted', 'rejected');

alter table public.tasks add column acceptance_status public.task_acceptance;
alter table public.tasks add column accepted_at      timestamptz;
alter table public.tasks add column rejected_reason  text;

-- When a task is assigned to a project contractor/contributor, it needs their
-- acceptance. Covers every assignment path (create, reassign, quote award).
create or replace function public.set_task_pending_on_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and coalesce(new.acceptance_status, 'pending') <> 'accepted'
     and exists (
       select 1 from public.project_members pm
       where pm.project_id = new.project_id
         and pm.user_id = new.assignee_id
         and pm.role in ('contractor', 'contributor')
     )
  then
    new.acceptance_status := 'pending';
    new.accepted_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_pending_on_assign on public.tasks;
create trigger tasks_pending_on_assign
  before insert or update of assignee_id on public.tasks
  for each row execute function public.set_task_pending_on_assign();

-- ── Subtasks — the contractor's plan ─────────────────────────────────────────
create table public.task_subtasks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  task_id            uuid not null,
  title              text not null,
  is_done            boolean not null default false,
  done_at            timestamptz,
  planned_start_date date,
  planned_end_date   date,
  position           int  not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);
create index task_subtasks_task_idx on public.task_subtasks (task_id, position);

alter table public.task_subtasks enable row level security;

-- Read: anyone who can view the project the task belongs to.
create policy task_subtasks_select on public.task_subtasks for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and (select public.can_view_project(t.project_id, t.org_id))
    )
  );

-- Write: the task's assignee (it's their plan) or a project manager / org staff.
create policy task_subtasks_write on public.task_subtasks for all
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(t.project_id, t.org_id)))
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(t.project_id, t.org_id)))
    )
  );

-- Stamp done_at + updated_at automatically.
create or replace function public.touch_subtask()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.is_done and not coalesce(old.is_done, false) then new.done_at := now();
  elsif not new.is_done then new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists task_subtasks_touch on public.task_subtasks;
create trigger task_subtasks_touch
  before update on public.task_subtasks
  for each row execute function public.touch_subtask();

-- ── Progress rollups (equal weight per subtask) ──────────────────────────────
-- Task %: done subtasks ÷ total. A done task is 100%; a task with no plan yet is 0%.
create or replace function public.task_progress(p_task_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case
    when (select status from public.tasks where id = p_task_id) = 'done' then 100
    else coalesce((
      select round(100.0 * count(*) filter (where is_done) / nullif(count(*), 0))::int
      from public.task_subtasks where task_id = p_task_id
    ), 0)
  end;
$$;

-- Project %: average of its tasks' progress. A new task dilutes it appropriately.
create or replace function public.project_progress(p_project_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(round(avg(public.task_progress(t.id)))::int, 0)
  from public.tasks t where t.project_id = p_project_id;
$$;
