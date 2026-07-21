-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BoQ / invoice PDFs on a plan or a sealed bid
--
-- A contractor can attach the actual Bill of Quantities (or an invoice) to the
-- plan they submit, or to their sealed tender bid. Bid docs are scoped by
-- bid_contractor_id and sealed exactly like bid lines: a bidder sees only their
-- own, the PM sees all. On award the winner's doc becomes the plan's.
--
-- Storage: tender invitees aren't project members, so the project-media policies
-- are extended to also admit a tender invitee under {org}/{project}/tasks/{task}/…
-- (segment [4] = task id; is_tender_invitee(garbage) is false, so this only ever
-- grants access to a genuine invitee on their own task).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.task_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null,
  task_id       uuid not null,
  uploaded_by   uuid references auth.users(id) on delete set null,
  bid_contractor_id uuid references auth.users(id) on delete cascade,   -- null = plan/awarded doc
  kind          text not null default 'boq' check (kind in ('boq', 'invoice')),
  filename      text not null,
  path          text not null,
  created_at    timestamptz not null default now(),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);
create index task_documents_task_idx on public.task_documents (task_id, bid_contractor_id);
alter table public.task_documents enable row level security;

-- Read: plan doc → project viewers; bid doc → its owner or a PM/staff.
create policy task_documents_select on public.task_documents for select using (
  case
    when bid_contractor_id is null then (select public.can_view_project(project_id, org_id))
    else bid_contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id))
  end
);
-- Write: plan doc → assignee or PM; bid doc → its owner (while an active invitee) or PM.
create policy task_documents_write on public.task_documents for all
  using (
    case
      when bid_contractor_id is null then
        exists (select 1 from public.tasks t where t.id = task_id
                and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id))))
      else bid_contractor_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id))
    end
  )
  with check (
    case
      when bid_contractor_id is null then
        exists (select 1 from public.tasks t where t.id = task_id
                and (t.assignee_id = (select auth.uid()) or (select public.can_manage_project(project_id, org_id))))
      else (bid_contractor_id = (select auth.uid()) and (select public.is_tender_invitee(task_id)))
           or (select public.can_manage_project(project_id, org_id))
    end
  );

alter publication supabase_realtime add table public.task_documents;

-- ── Storage: admit tender invitees under the task doc path ──
drop policy if exists "project-media read" on storage.objects;
create policy "project-media read" on storage.objects for select to authenticated using (
  bucket_id = 'project-media' and (
    (select public.can_view_project(
       public.safe_uuid((storage.foldername(name))[2]), public.safe_uuid((storage.foldername(name))[1])))
    or (select public.is_tender_invitee(public.safe_uuid((storage.foldername(name))[4])))
  )
);
drop policy if exists "project-media upload" on storage.objects;
create policy "project-media upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'project-media' and (
    (select public.can_view_project(
       public.safe_uuid((storage.foldername(name))[2]), public.safe_uuid((storage.foldername(name))[1])))
    or (select public.is_tender_invitee(public.safe_uuid((storage.foldername(name))[4])))
  )
);
drop policy if exists "project-media delete" on storage.objects;
create policy "project-media delete" on storage.objects for delete to authenticated using (
  bucket_id = 'project-media' and (
    (select public.can_manage_project(
       public.safe_uuid((storage.foldername(name))[2]), public.safe_uuid((storage.foldername(name))[1])))
    or (select public.is_tender_invitee(public.safe_uuid((storage.foldername(name))[4])))
  )
);

-- ── Award: the winner's doc becomes the plan's; losing bids' docs are dropped ──
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

  update public.task_subtasks set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_subtasks
    where task_id = p_task_id and bid_contractor_id is not null;

  update public.task_documents set bid_contractor_id = null
    where task_id = p_task_id and bid_contractor_id = p_winner;
  delete from public.task_documents
    where task_id = p_task_id and bid_contractor_id is not null;

  select coalesce(sum(cost_cents), 0) into v_total
    from public.task_subtasks
    where task_id = p_task_id and (is_variation = false or variation_status = 'approved');

  perform set_config('app.tender_award', 'on', true);
  update public.tasks set
    assignee_id = p_winner,
    acceptance_status = 'accepted',
    accepted_at = now(),
    plan_approved_at = now(),
    awarded_cost_cents = v_total
  where id = p_task_id;
  perform set_config('app.tender_award', 'off', true);

  update public.task_tender_invites set status = 'awarded', decided_at = now()
    where task_id = p_task_id and contractor_id = p_winner;
  update public.task_tender_invites set status = 'not_selected', decided_at = now()
    where task_id = p_task_id and contractor_id <> p_winner and status in ('invited', 'submitted');
end $$;
