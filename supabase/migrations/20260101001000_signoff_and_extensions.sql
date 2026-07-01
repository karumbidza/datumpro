-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project-PM sign-off + task extension requests
--
-- 1. Sign-off authority now follows the project model: a task can be approved to
--    DONE by an org owner/admin OR the project's PM (not just org-level roles).
--    This matches can_manage_project used everywhere else.
-- 2. Extension requests: the executor (contractor/assignee) asks for a new due
--    date with a reason; the PM approves (shifts the deadline — the CPM engine
--    then recomputes the schedule/critical path) or rejects. Baseline stays
--    frozen so variance remains visible.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Sign-off guard: org admin OR the project's PM (system context still allowed) ──
create or replace function public.guard_task_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    if (select auth.uid()) is not null
       and not public.can_manage_project(new.project_id, new.org_id) then
      raise exception 'only a project manager can approve a task as done';
    end if;
  end if;
  return new;
end;
$$;

-- ── Extension requests ──
create type public.extension_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.task_extension_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null,
  task_id           uuid not null,
  requested_by      uuid references auth.users(id) on delete set null,
  proposed_due_date date not null,
  reason            text,
  status            public.extension_status not null default 'pending',
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index task_extension_requests_task_idx on public.task_extension_requests (task_id);

alter table public.task_extension_requests enable row level security;

-- Everyone on the project sees them; the executor raises their own; the PM decides.
create policy task_extension_select on public.task_extension_requests for select
  using ((select public.can_view_project(project_id, org_id)));
create policy task_extension_insert on public.task_extension_requests for insert
  with check ((select public.can_view_project(project_id, org_id)) and requested_by = (select auth.uid()));
create policy task_extension_update on public.task_extension_requests for update
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));
