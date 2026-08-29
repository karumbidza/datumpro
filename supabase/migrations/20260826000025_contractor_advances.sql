-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — contractor advances (recouped against progress claims)
--
-- A manager issues an advance to a contractor on a project (mobilisation money,
-- say). We record the figure; the money side is settled outside the app for now.
--
-- The advance is recouped by FULL OFFSET: a contractor's progress claims across
-- the project are offset by the advance, so no new cash is claimable until their
-- earned work (Σ task entitlements) exceeds the advance. Once it does, the excess
-- pays out as normal. Recoupment is implicit — outstanding = max(0, advance −
-- earned) — so there is no separate drawdown row to keep in step.
--
-- Advances are an immutable financial record (never deleted); an advance issued in
-- error is corrected by cancelling it (status→cancelled) via RPC, which is audited.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.contractor_advances (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid   not null references public.organizations(id) on delete cascade,
  project_id    uuid   not null,
  contractor_id uuid   not null references auth.users(id) on delete cascade,
  amount_cents  bigint not null check (amount_cents > 0),
  reference     text,          -- payment reference / cheque no. (free text)
  note          text,          -- what the advance is for
  status        text   not null default 'active' check (status in ('active', 'cancelled')),
  created_by    uuid references auth.users(id) on delete set null,
  cancelled_by  uuid references auth.users(id) on delete set null,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists contractor_advances_project_idx
  on public.contractor_advances (project_id, contractor_id);

alter table public.contractor_advances enable row level security;

-- Cost-confidential, mirroring contractor_payment_requests: org staff / finance,
-- the project PM, and the owning contractor.
create policy contractor_advances_select on public.contractor_advances for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
    or contractor_id = (select auth.uid())
    or coalesce((select public.org_role(org_id)) = 'finance', false)
  );
-- No insert/update/delete policies: writes go only through the SECURITY DEFINER
-- RPCs below, and the row is a permanent financial record.
create or replace function public.prevent_contractor_advance_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Advances are a financial record and cannot be deleted — cancel it instead.'
    using errcode = 'insufficient_privilege';
end;
$$;
drop trigger if exists trg_contractor_advance_no_delete on public.contractor_advances;
create trigger trg_contractor_advance_no_delete
  before delete on public.contractor_advances
  for each row execute function public.prevent_contractor_advance_delete();

-- ── Advance math ──────────────────────────────────────────────────────────────

-- Total advance a contractor currently holds on a project (active advances only).
create or replace function public.project_contractor_advance_cents(p_project_id uuid, p_contractor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint
  from public.contractor_advances
  where project_id = p_project_id and contractor_id = p_contractor and status = 'active';
$$;

-- A contractor's total net entitlement earned across their approved tasks in a
-- project (each task's milestone-and-retention entitlement). The advance is
-- recouped out of this pool before any cash is claimable.
create or replace function public.project_contractor_entitlement_cents(p_project_id uuid, p_contractor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(public.task_payment_entitlement_cents(t.id)), 0)::bigint
  from public.tasks t
  where t.project_id = p_project_id
    and t.assignee_id = p_contractor
    and t.plan_approved_at is not null;
$$;

-- ── Insert gate: a progress claim recoups the outstanding advance first ────────
-- Adds the project-wide advance offset to the existing per-task milestone cap and
-- the retention branch. Rewrites the body from 20260826000023_retention_release.
create or replace function public.enforce_payment_request_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_assignee         uuid;
  v_awarded          bigint;
  v_approved         timestamptz;
  v_used             bigint;
  v_entitlement      bigint;
  v_pool             bigint;
  v_deducted         bigint;
  v_advance          bigint;
  v_proj_entitlement bigint;
  v_proj_used        bigint;
begin
  if new.invoice_path is null then
    raise exception 'An invoice is required to request payment';
  end if;

  -- Retention release: a project-level claim against the held retention, unlocked
  -- only once the defects-liability period has elapsed. No task, no milestone cap.
  if new.kind = 'retention' then
    if new.task_id is not null then
      raise exception 'A retention release is claimed for the project, not a single task';
    end if;
    if not public.project_retention_releasable(new.project_id) then
      raise exception 'Retention is not releasable yet — the defects-liability period has not elapsed';
    end if;
    v_pool     := public.project_contractor_retention_cents(new.project_id, new.contractor_id);
    v_deducted := public.project_contractor_retention_deducted_cents(new.project_id, new.contractor_id);
    select coalesce(sum(amount_cents), 0) into v_used
      from public.contractor_payment_requests
      where project_id = new.project_id
        and contractor_id = new.contractor_id
        and kind = 'retention'
        and status not in ('rejected', 'cancelled');
    if v_pool - v_deducted <= 0 then
      raise exception 'No retention is available to release (it may have been spent on repairs)';
    end if;
    if v_used + new.amount_cents > v_pool - v_deducted then
      raise exception 'Amount exceeds the retention still owed on this project';
    end if;
    return new;
  end if;

  -- Progress claim (default): assignee, approved plan, milestone-and-retention cap.
  if new.task_id is null then
    raise exception 'A payment request must reference a task';
  end if;
  select assignee_id, coalesce(awarded_cost_cents, 0), plan_approved_at
    into v_assignee, v_awarded, v_approved
    from public.tasks where id = new.task_id;
  if v_assignee is null or v_assignee is distinct from new.contractor_id then
    raise exception 'Only the task assignee can request payment for it';
  end if;
  if v_approved is null or v_awarded <= 0 then
    raise exception 'This task has no approved plan amount to invoice';
  end if;

  select coalesce(sum(amount_cents), 0) into v_used
    from public.contractor_payment_requests
    where task_id = new.task_id
      and contractor_id = new.contractor_id
      and status not in ('rejected', 'cancelled');

  v_entitlement := public.task_payment_entitlement_cents(new.task_id);
  if v_used + new.amount_cents > v_entitlement then
    raise exception 'Amount exceeds what''s claimable at this stage — progress unlocks payment in steps (25/50/75/90/100%%) and retention is held back';
  end if;

  -- Advance recoupment: project-wide, cash claimable = max(0, Σ entitlements −
  -- advances). The first <advance> of earned work is offset, so claims cannot draw
  -- cash until earnings exceed the advance.
  v_advance := public.project_contractor_advance_cents(new.project_id, new.contractor_id);
  if v_advance > 0 then
    v_proj_entitlement := public.project_contractor_entitlement_cents(new.project_id, new.contractor_id);
    select coalesce(sum(amount_cents), 0) into v_proj_used
      from public.contractor_payment_requests
      where project_id = new.project_id
        and contractor_id = new.contractor_id
        and kind = 'milestone'
        and status not in ('rejected', 'cancelled');
    if v_proj_used + new.amount_cents > greatest(0, v_proj_entitlement - v_advance) then
      raise exception 'This claim recoups the outstanding advance first — cash unlocks once earned work exceeds the advance';
    end if;
  end if;

  return new;
end;
$function$;

-- ── Manager RPCs: issue an advance, cancel one issued in error ────────────────

-- Record an advance for a contractor on a project. PM / org staff / finance.
create or replace function public.issue_contractor_advance(
  p_project uuid, p_contractor uuid, p_amount bigint, p_reference text, p_note text)
  returns uuid language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'an advance amount is required'; end if;
  select org_id into v_org from public.projects where id = p_project;
  if v_org is null then raise exception 'project not found'; end if;
  if not (public.is_org_staff(v_org)
          or coalesce(public.project_role(p_project) = 'pm', false)
          or coalesce(public.org_role(v_org) = 'finance', false)) then
    raise exception 'not authorised to issue an advance';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = p_contractor
  ) then
    raise exception 'the advance recipient is not a member of this project';
  end if;

  insert into public.contractor_advances (org_id, project_id, contractor_id, amount_cents, reference, note, created_by)
  values (v_org, p_project, p_contractor, p_amount, nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), uid)
  returning id into v_id;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_org, uid, 'contractor_advance', v_id, 'advance.issued', null,
          jsonb_build_object('project_id', p_project, 'contractor_id', p_contractor, 'amount_cents', p_amount));
  return v_id;
end;
$function$;
revoke all on function public.issue_contractor_advance(uuid, uuid, bigint, text, text) from public;
grant execute on function public.issue_contractor_advance(uuid, uuid, bigint, text, text) to authenticated;

-- Cancel an advance issued in error (the only correction — the row is never
-- deleted). Frees any cash it was offsetting. PM / org staff / finance.
create or replace function public.cancel_contractor_advance(p_advance uuid, p_reason text)
  returns void language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); r public.contractor_advances;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into r from public.contractor_advances where id = p_advance;
  if not found then raise exception 'advance not found'; end if;
  if r.status <> 'active' then raise exception 'this advance is already cancelled'; end if;
  if not (public.is_org_staff(r.org_id)
          or coalesce(public.project_role(r.project_id) = 'pm', false)
          or coalesce(public.org_role(r.org_id) = 'finance', false)) then
    raise exception 'not authorised to cancel an advance';
  end if;

  update public.contractor_advances
    set status = 'cancelled', cancelled_by = uid, cancelled_at = now()
    where id = p_advance;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (r.org_id, uid, 'contractor_advance', p_advance, 'advance.cancelled',
          jsonb_build_object('status', 'active', 'amount_cents', r.amount_cents),
          jsonb_build_object('status', 'cancelled', 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$function$;
revoke all on function public.cancel_contractor_advance(uuid, text) from public;
grant execute on function public.cancel_contractor_advance(uuid, text) to authenticated;
