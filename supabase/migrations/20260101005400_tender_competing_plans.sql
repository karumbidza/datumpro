-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — tender by competing plans (sealed bids)
--
-- A PM can invite several contractors to tender a task. Each invitee builds their
-- OWN priced plan (reusing task_subtasks, scoped by bid_contractor_id) and submits
-- it as a sealed bid. The PM compares the plans and awards one — the winner's plan
-- becomes the task's plan, the losers' are cleared, and the winner is assigned.
--
-- Sealed-bid isolation is enforced in RLS, not just the UI:
--   • an invitee sees/edits ONLY their own bid lines and their own invite;
--   • invitees are NOT project members (so the Team page can't leak co-bidders) —
--     access is granted task-scoped via the invite;
--   • the PM/org staff see every bid.
-- Award is final: the PM's decision locks the winner's plan (no second approval).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. A subtask can be a competing bid line. null = the active/awarded plan (today).
alter table public.task_subtasks
  add column bid_contractor_id uuid references auth.users(id) on delete cascade;
create index task_subtasks_bid_idx on public.task_subtasks (task_id, bid_contractor_id);

-- 2. Who's invited to tender a task, and where their bid stands.
create table public.task_tender_invites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null,
  task_id       uuid not null,
  contractor_id uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'invited'
                  check (status in ('invited', 'submitted', 'awarded', 'not_selected', 'withdrawn')),
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  decided_at    timestamptz,
  unique (task_id, contractor_id),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);
create index task_tender_invites_task_idx on public.task_tender_invites (task_id);
create index task_tender_invites_contractor_idx on public.task_tender_invites (contractor_id);

alter table public.task_tender_invites enable row level security;

-- 3. Am I an active invitee of this task? (drives task-scoped bid access)
create or replace function public.is_tender_invitee(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.task_tender_invites i
    where i.task_id = p_task_id
      and i.contractor_id = (select auth.uid())
      and i.status in ('invited', 'submitted')
  );
$$;

-- invitee sees only their own row; PM/staff see all for the project.
create policy tender_invites_select on public.task_tender_invites for select
  using (
    contractor_id = (select auth.uid())
    or (select public.can_manage_project(project_id, org_id))
  );
-- only PM/staff manage invites directly (invite / withdraw). Contractors submit
-- their bid via submit_tender_bid(); awarding runs through award_tender().
create policy tender_invites_write on public.task_tender_invites for all
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

-- 4. Let an active invitee see the task itself (they're not a project member).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (select public.can_view_project(project_id, org_id))
    or (select public.is_tender_invitee(id))
  );

-- 5. Subtask visibility with sealed bids.
--    • active line (bid null): any project viewer (today's rule)
--    • bid line: only its owner, or a PM/staff of the project
drop policy if exists task_subtasks_select on public.task_subtasks;
create policy task_subtasks_select on public.task_subtasks for select
  using (
    case
      when bid_contractor_id is null then
        exists (select 1 from public.tasks t
                where t.id = task_id and (select public.can_view_project(t.project_id, t.org_id)))
      else
        bid_contractor_id = (select auth.uid())
        or exists (select 1 from public.tasks t
                   where t.id = task_id and (select public.can_manage_project(t.project_id, t.org_id)))
    end
  );

-- 6. Subtask writes.
--    • active line: the assignee (their plan) or a PM/staff (today's rule)
--    • bid line: only its owner, and only while they're an active invitee
drop policy if exists task_subtasks_write on public.task_subtasks;
create policy task_subtasks_write on public.task_subtasks for all
  using (
    case
      when bid_contractor_id is null then
        exists (select 1 from public.tasks t
                where t.id = task_id
                  and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(t.project_id, t.org_id))))
      else
        bid_contractor_id = (select auth.uid())
        or exists (select 1 from public.tasks t
                   where t.id = task_id and (select public.can_manage_project(t.project_id, t.org_id)))
    end
  )
  with check (
    case
      when bid_contractor_id is null then
        exists (select 1 from public.tasks t
                where t.id = task_id
                  and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(t.project_id, t.org_id))))
      else
        (bid_contractor_id = (select auth.uid()) and (select public.is_tender_invitee(task_id)))
        or exists (select 1 from public.tasks t
                   where t.id = task_id and (select public.can_manage_project(t.project_id, t.org_id)))
    end
  );

-- 7. A contractor submits their sealed bid (their plan must be fully priced/dated).
create or replace function public.submit_tender_bid(p_task_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.task_tender_invites
    where task_id = p_task_id and contractor_id = v_uid and status in ('invited', 'submitted')
  ) then
    raise exception 'you are not invited to tender this task';
  end if;
  if not exists (select 1 from public.task_subtasks where task_id = p_task_id and bid_contractor_id = v_uid) then
    raise exception 'add at least one step to your plan before submitting';
  end if;
  if exists (
    select 1 from public.task_subtasks
    where task_id = p_task_id and bid_contractor_id = v_uid
      and (cost_cents <= 0 or est_qty is null or est_unit is null or planned_start_date is null)
  ) then
    raise exception 'every step needs a duration, a start date and a cost';
  end if;
  update public.task_tender_invites
    set status = 'submitted', submitted_at = now()
    where task_id = p_task_id and contractor_id = v_uid;
end $$;

-- 8. The PM awards a tender. The winner's plan becomes the task's; losers cleared.
--    The caller must already have enrolled the winner as a project member (the
--    app does this before calling, so the assignee-is-a-member rule holds).
create or replace function public.award_tender(p_task_id uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_project uuid; v_total bigint;
begin
  select org_id, project_id into v_org, v_project from public.tasks where id = p_task_id;
  if v_org is null then raise exception 'task not found'; end if;
  if not (select public.can_manage_project(v_project, v_org)) then
    raise exception 'only a project manager can award a tender';
  end if;
  if not exists (
    select 1 from public.task_tender_invites
    where task_id = p_task_id and contractor_id = p_winner and status = 'submitted'
  ) then
    raise exception 'that contractor has not submitted a bid';
  end if;

  -- winner's bid lines become the active plan; everyone else's are cleared
  update public.task_subtasks set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_subtasks
    where task_id = p_task_id and bid_contractor_id is not null;

  select coalesce(sum(cost_cents), 0) into v_total
    from public.task_subtasks
    where task_id = p_task_id and (is_variation = false or variation_status = 'approved');

  -- assign + lock the plan (award is final — no second approval). Setting
  -- acceptance_status='accepted' keeps the on-assign trigger from re-pending it,
  -- and setting plan_approved_at (not plan_submitted_at) avoids seeding a chain.
  update public.tasks set
    assignee_id = p_winner,
    acceptance_status = 'accepted',
    accepted_at = now(),
    plan_approved_at = now(),
    awarded_cost_cents = v_total
  where id = p_task_id;

  update public.task_tender_invites set status = 'awarded', decided_at = now()
    where task_id = p_task_id and contractor_id = p_winner;
  update public.task_tender_invites set status = 'not_selected', decided_at = now()
    where task_id = p_task_id and contractor_id <> p_winner and status in ('invited', 'submitted');
end $$;

-- 9. Live updates for the tender surfaces.
alter publication supabase_realtime add table public.task_tender_invites;
