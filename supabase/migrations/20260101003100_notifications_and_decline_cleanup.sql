-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — in-app notifications + tidy reassignment
--
-- 1. A per-user notifications feed (bell). Insert only through notify(), which
--    checks the caller shares the target's org — so a client can't spam anyone.
-- 2. Assigning a task to a new person now starts them from a clean slate: the
--    previous assignee's subtask plan and any decline reason are cleared.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read + mark-read only your own. No insert policy → only notify() (definer) writes.
create policy notifications_select on public.notifications for select
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete
  using (user_id = (select auth.uid()));

-- Create a notification for another user — guarded so the caller must be an
-- active member of the same org (no cross-org spam).
create or replace function public.notify(
  p_org uuid, p_user uuid, p_type text, p_title text,
  p_body text default null, p_link text default null,
  p_entity_type text default null, p_entity_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user = (select auth.uid()) then return; end if;  -- never notify yourself
  if not exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = (select auth.uid()) and status = 'active'
  ) then
    raise exception 'not authorized to notify in this org';
  end if;
  insert into public.notifications (org_id, user_id, type, title, body, link, entity_type, entity_id)
  values (p_org, p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id);
end;
$$;

-- Reassignment cleanup: when a task is assigned to a NEW person, wipe the prior
-- plan + decline reason and (for a contractor) require their acceptance.
create or replace function public.set_task_pending_on_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    new.rejected_reason := null;
    if tg_op = 'UPDATE' then
      delete from public.task_subtasks where task_id = new.id;  -- fresh plan for the new assignee
    end if;
    if coalesce(new.acceptance_status, 'pending') <> 'accepted'
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
  end if;
  return new;
end;
$$;
