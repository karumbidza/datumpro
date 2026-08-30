-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — action items (lightweight to-dos raised from the project chat)
--
-- A quick "can you do X by Friday" ask: a title, an assignee, and a deadline.
-- Deliberately NOT a formal task — no pricing, approvals, SLA, sign-off or
-- dependencies — so any project member can raise one for anyone, and it shows up
-- on the project calendar alongside task dates. Optionally linked back to the chat
-- message it came from.
--
-- Scope + access follow the project-chat model: any member of the project (or org
-- staff) can see and raise them; the assignee, the raiser, or a manager can update;
-- the raiser or a manager can remove one.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.action_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid   not null references public.organizations(id) on delete cascade,
  project_id      uuid   not null,
  conversation_id uuid,          -- the chat it was raised from (soft link)
  message_id      uuid,          -- the source message (soft link)
  title           text   not null,
  detail          text,          -- optional note
  assignee_id     uuid references auth.users(id) on delete set null,  -- null = unassigned
  created_by      uuid references auth.users(id) on delete set null,
  due_date        date,          -- deadline (null = no date)
  status          text   not null default 'open' check (status in ('open', 'done')),
  done_at         timestamptz,
  done_by         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Tenant-consistent: org_id is forced to equal the project's org_id.
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists action_items_project_idx  on public.action_items (project_id, status);
create index if not exists action_items_assignee_idx on public.action_items (assignee_id, status);
create index if not exists action_items_due_idx      on public.action_items (project_id, due_date);

alter table public.action_items enable row level security;

-- Any project member (or org staff) can see the project's action items.
create policy action_items_select on public.action_items for select
  using (
    (select public.is_project_member(project_id))
    or (select public.is_org_staff(org_id))
  );

-- A member raises their own (created_by = them); scope must be one they belong to.
create policy action_items_insert on public.action_items for insert
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_project_member(project_id))
      or (select public.is_org_staff(org_id))
    )
  );

-- The assignee (to mark done), the raiser (to edit/reassign), or a manager can update.
create policy action_items_update on public.action_items for update
  using (
    assignee_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  )
  with check (
    assignee_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- The raiser or a manager can remove one (a to-do is not a financial record).
create policy action_items_delete on public.action_items for delete
  using (
    created_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

-- Live updates on the calendar / chat, same as tasks & site reports.
alter publication supabase_realtime add table public.action_items;
