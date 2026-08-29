-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — retention release (defects-liability period)
--
-- Retention (projects.retention_pct) is withheld from every progress claim and,
-- until now, simply accrued and was never claimable. This adds the release side:
--
--   1. A defects-liability period is agreed at project setup
--      (projects.retention_period_months, e.g. 6–12). It exists to cover poor
--      workmanship: during the period the PM may spend the held retention on
--      repairs (a recorded deduction), which reduces what is eventually released.
--   2. The clock starts at PRACTICAL COMPLETION (projects.practical_completion_at,
--      stamped by mark_practical_completion). Retention becomes releasable once
--      now() >= practical_completion_at + the agreed period.
--   3. Release is a normal invoice: the contractor raises ONE retention claim
--      (a contractor_payment_requests row, kind='retention', no task) for the net
--      retention, which then flows through the usual approve → pay machinery.
--
-- Retention is per contractor, per project = the sum withheld across their tasks.
-- Released at once (not staged). Deductions are an immutable ledger, consistent
-- with the "never delete the money / audit trail" rule.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Project fields: agreed period + practical-completion anchor ────────────
alter table public.projects
  add column if not exists retention_period_months int,
  add column if not exists practical_completion_at timestamptz;
alter table public.projects
  add constraint projects_retention_period_chk
  check (retention_period_months is null or retention_period_months between 0 and 120);

-- ── 2. Distinguish a retention claim from a progress claim ────────────────────
alter table public.contractor_payment_requests
  add column if not exists kind text not null default 'milestone';
alter table public.contractor_payment_requests
  add constraint cpr_kind_chk check (kind in ('milestone', 'retention'));

-- ── 3. Deductions ledger: retention spent on repairs during the period ────────
create table if not exists public.retention_deductions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid   not null references public.organizations(id) on delete cascade,
  project_id    uuid   not null,
  contractor_id uuid   not null references auth.users(id) on delete cascade,
  amount_cents  bigint not null check (amount_cents > 0),
  reason        text   not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index if not exists retention_deductions_project_idx
  on public.retention_deductions (project_id, contractor_id);

alter table public.retention_deductions enable row level security;

-- Cost-confidential, mirroring contractor_payment_requests: org staff / finance,
-- the project PM, and the owning contractor.
create policy retention_deductions_select on public.retention_deductions for select
  using (
    (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
    or contractor_id = (select auth.uid())
    or coalesce((select public.org_role(org_id)) = 'finance', false)
  );
-- No insert/update/delete policies: writes happen only through the SECURITY DEFINER
-- RPC below, and the row is a permanent financial record.
create or replace function public.prevent_retention_deduction_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Retention deductions are a financial record and cannot be deleted.'
    using errcode = 'insufficient_privilege';
end;
$$;
drop trigger if exists trg_retention_deduction_no_delete on public.retention_deductions;
create trigger trg_retention_deduction_no_delete
  before delete on public.retention_deductions
  for each row execute function public.prevent_retention_deduction_delete();

-- ── 4. Retention math ─────────────────────────────────────────────────────────

-- Retention withheld on one task to date = gross milestone valuation − net
-- entitlement = floor(ret% × gross). Same base/stepped derivation as
-- task_payment_entitlement_cents, so the two always reconcile (gross = net + this).
create or replace function public.task_retention_withheld_cents(p_task_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  with base as (
    select coalesce(tk.awarded_cost_cents, 0) as awarded,
           coalesce(p.retention_pct, 0)        as ret,
           public.task_progress_pct(tk.id)     as pct
    from public.tasks tk
    join public.projects p on p.id = tk.project_id
    where tk.id = p_task_id
  ),
  stepped as (
    select awarded, ret,
      case
        when pct >= 100 then 100 when pct >= 90 then 90 when pct >= 75 then 75
        when pct >= 50 then 50   when pct >= 25 then 25 else 0
      end as milestone
    from base
  ),
  wdd as (
    select floor(milestone::numeric / 100 * awarded)::bigint as gross, ret from stepped
  )
  select coalesce(floor(ret / 100 * gross)::bigint, 0) from wdd;
$$;

-- Total retention withheld for a contractor across their approved tasks in a project.
create or replace function public.project_contractor_retention_cents(p_project_id uuid, p_contractor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(public.task_retention_withheld_cents(t.id)), 0)::bigint
  from public.tasks t
  where t.project_id = p_project_id
    and t.assignee_id = p_contractor
    and t.plan_approved_at is not null;
$$;

-- Retention already spent on repairs for a contractor on a project.
create or replace function public.project_contractor_retention_deducted_cents(p_project_id uuid, p_contractor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint
  from public.retention_deductions
  where project_id = p_project_id and contractor_id = p_contractor;
$$;

-- Net retention still owed to a contractor = withheld − deducted − what they've
-- already claimed back (retention requests not rejected/cancelled). Floors at 0.
create or replace function public.project_contractor_retention_available_cents(p_project_id uuid, p_contractor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select greatest(
    0,
    public.project_contractor_retention_cents(p_project_id, p_contractor)
      - public.project_contractor_retention_deducted_cents(p_project_id, p_contractor)
      - coalesce((
          select sum(amount_cents) from public.contractor_payment_requests
          where project_id = p_project_id and contractor_id = p_contractor
            and kind = 'retention' and status not in ('rejected', 'cancelled')
        ), 0)
  )::bigint;
$$;

-- The date retention becomes releasable (practical completion + agreed period),
-- and whether that has been reached. Null when practical completion isn't stamped.
create or replace function public.project_retention_release_at(p_project_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case
    when practical_completion_at is null then null
    else practical_completion_at + make_interval(months => coalesce(retention_period_months, 0))
  end
  from public.projects where id = p_project_id;
$$;

create or replace function public.project_retention_releasable(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.project_retention_release_at(p_project_id) is not null
     and now() >= public.project_retention_release_at(p_project_id);
$$;

-- ── 5. Insert gate: branch a retention claim off the progress-claim path ───────
create or replace function public.enforce_payment_request_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_assignee    uuid;
  v_awarded     bigint;
  v_approved    timestamptz;
  v_used        bigint;
  v_entitlement bigint;
  v_pool        bigint;
  v_deducted    bigint;
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
  return new;
end;
$function$;

-- ── 6. Manager RPCs: stamp practical completion, record a deduction ───────────

-- Start the defects-liability clock and mark the project complete. PM or org staff.
create or replace function public.mark_practical_completion(p_project uuid)
  returns void language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); pc timestamptz; v_org uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select org_id, practical_completion_at into v_org, pc from public.projects where id = p_project;
  if v_org is null then raise exception 'project not found'; end if;
  if not (public.is_org_staff(v_org) or coalesce(public.project_role(p_project) = 'pm', false)) then
    raise exception 'not authorised to complete this project';
  end if;
  if pc is not null then raise exception 'practical completion is already recorded'; end if;

  update public.projects
    set practical_completion_at = now(), status = 'completed'
    where id = p_project;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_org, uid, 'project', p_project, 'project.practical_completion',
          jsonb_build_object('practical_completion_at', null),
          jsonb_build_object('practical_completion_at', now()));
end;
$function$;
revoke all on function public.mark_practical_completion(uuid) from public;
grant execute on function public.mark_practical_completion(uuid) to authenticated;

-- Record retention spent on repairs (poor workmanship) for one contractor. The PM
-- or org finance/staff may do this; it reduces the contractor's releasable retention.
create or replace function public.record_retention_deduction(
  p_project uuid, p_contractor uuid, p_amount bigint, p_reason text)
  returns uuid language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'a deduction amount is required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'a reason is required'; end if;
  select org_id into v_org from public.projects where id = p_project;
  if v_org is null then raise exception 'project not found'; end if;
  if not (public.is_org_staff(v_org)
          or coalesce(public.project_role(p_project) = 'pm', false)
          or coalesce(public.org_role(v_org) = 'finance', false)) then
    raise exception 'not authorised to record a retention deduction';
  end if;

  insert into public.retention_deductions (org_id, project_id, contractor_id, amount_cents, reason, created_by)
  values (v_org, p_project, p_contractor, p_amount, btrim(p_reason), uid)
  returning id into v_id;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_org, uid, 'retention_deduction', v_id, 'retention.deducted', null,
          jsonb_build_object('project_id', p_project, 'contractor_id', p_contractor,
                             'amount_cents', p_amount, 'reason', btrim(p_reason)));
  return v_id;
end;
$function$;
revoke all on function public.record_retention_deduction(uuid, uuid, bigint, text) from public;
grant execute on function public.record_retention_deduction(uuid, uuid, bigint, text) to authenticated;
