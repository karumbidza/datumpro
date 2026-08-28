-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — ledger delete-protection ("never delete the money / audit trail")
--
-- Rule: real financial figures and the audit trail are permanent — they will be
-- exported to accounting/Excel and must survive for audit. We protect COMMITTED
-- money (locked/awarded prices, approved figures, and paid/approved payments) plus
-- the immutable audit log. Draft/working data (estimates, unapproved plans, losing
-- tender bids) stays freely editable, so estimating and tender award keep working.
--
-- Enforcement mirrors the existing guard_workflow_transition pattern: BEFORE
-- triggers that raise. Because a BEFORE DELETE trigger also fires when a row is
-- removed via ON DELETE CASCADE, deleting a project/org that has committed money or
-- audit history now ABORTS — delivering "block parent delete if money/audit exists"
-- with no foreign-key surgery. An empty, draft-only project stays deletable.
--
-- Scope notes:
--   • approvals is deliberately NOT guarded — it is working approval-chain state
--     that is legitimately reset on plan resubmit (seed_task_plan_approvals clears
--     the stale chain). The permanent record of every decision lives in audit_logs.
--   • No RPC deletes from any table guarded here except task_subtasks, and those
--     RPCs (award_tender, reassign/decline, export/reprice) only ever delete
--     draft/losing rows — never an approved variation — so they are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Immutable audit trail: audit_logs + task_activity are append-only ─────
-- Nothing in the app or any migration updates or deletes these tables; blocking
-- both makes the guarantee explicit and tamper-evident, and (via cascade) stops an
-- org/project delete from erasing the log.
create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Audit records are append-only and cannot be % (table %).', lower(tg_op), tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_audit_logs_append_only on public.audit_logs;
create trigger trg_audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

drop trigger if exists trg_task_activity_append_only on public.task_activity;
create trigger trg_task_activity_append_only
  before update or delete on public.task_activity
  for each row execute function public.prevent_audit_mutation();

-- ── 2. Payment requests are a permanent financial record (never deleted) ─────
-- Withdrawal is a status change to 'cancelled' (see the update trigger below), so
-- the row and its amount always stay. Drop the delete policy AND add a trigger:
-- the policy stops PostgREST deletes, the trigger also blocks cascade + any RPC.
drop policy if exists cpr_delete on public.contractor_payment_requests;

create or replace function public.prevent_payment_request_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Payment requests are a financial record and cannot be deleted — cancel it instead.'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_cpr_no_delete on public.contractor_payment_requests;
create trigger trg_cpr_no_delete
  before delete on public.contractor_payment_requests
  for each row execute function public.prevent_payment_request_delete();

-- ── 3. Committed task price: an awarded / plan-approved task can't be deleted ─
create or replace function public.prevent_committed_task_delete()
returns trigger language plpgsql as $$
begin
  if old.plan_approved_at is not null or coalesce(old.awarded_cost_cents, 0) > 0 then
    raise exception 'This task holds a locked/awarded figure and cannot be deleted (audit trail).'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_tasks_no_delete_committed on public.tasks;
create trigger trg_tasks_no_delete_committed
  before delete on public.tasks
  for each row execute function public.prevent_committed_task_delete();

-- ── 4. Approved variation (additional works) is a committed figure ───────────
-- Only approved variations are protected; draft plan lines and losing bids (which
-- award_tender / reassign / reprice delete) are never 'approved', so those flows
-- keep working.
create or replace function public.prevent_approved_variation_delete()
returns trigger language plpgsql as $$
begin
  if old.variation_status = 'approved' then
    raise exception 'An approved variation (additional works) is a financial record and cannot be deleted.'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_subtasks_no_delete_approved_variation on public.task_subtasks;
create trigger trg_subtasks_no_delete_approved_variation
  before delete on public.task_subtasks
  for each row execute function public.prevent_approved_variation_delete();

-- ── 5. Approved variation_orders (legacy table) — defensive parity ───────────
create or replace function public.prevent_approved_variation_order_delete()
returns trigger language plpgsql as $$
begin
  if old.status = 'approved' then
    raise exception 'An approved variation order is a financial record and cannot be deleted.'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_variation_orders_no_delete_approved on public.variation_orders;
create trigger trg_variation_orders_no_delete_approved
  before delete on public.variation_orders
  for each row execute function public.prevent_approved_variation_order_delete();

-- ── 6. Withdrawal keeps the row: allow a contractor to cancel a pending request ─
-- Rewrites enforce_payment_request_update to permit OLD.status='requested' →
-- NEW.status='cancelled' by the owning contractor (no other field may change), and
-- treats 'cancelled' as terminal for managers. Everything else is unchanged.
create or replace function public.enforce_payment_request_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  is_manager   boolean;
  is_cancelling boolean;
begin
  is_manager := public.is_org_staff(NEW.org_id)
                or coalesce(public.project_role(NEW.project_id) = 'pm', false);
  -- Compare via ::text so this function never has to resolve the enum literal.
  is_cancelling := NEW.status::text = 'cancelled' and OLD.status::text = 'requested';

  if not is_manager then
    -- Contractor: may only tweak their own still-pending request; never move money.
    if OLD.status <> 'requested' then
      raise exception 'This request can no longer be edited';
    end if;
    if is_cancelling then
      -- Withdrawal: a status change to 'cancelled' only. No manager-only fields.
      if NEW.reviewed_by is distinct from OLD.reviewed_by
         or NEW.paid_at    is distinct from OLD.paid_at
         or NEW.pop_path   is distinct from OLD.pop_path
         or NEW.contractor_id <> OLD.contractor_id then
        raise exception 'Only a manager can review or pay a request';
      end if;
    elsif NEW.status <> OLD.status
       or NEW.reviewed_by is distinct from OLD.reviewed_by
       or NEW.paid_at    is distinct from OLD.paid_at
       or NEW.pop_path   is distinct from OLD.pop_path
       or NEW.contractor_id <> OLD.contractor_id then
      raise exception 'Only a manager can review or pay a request';
    end if;
  else
    -- Manager: terminal states are final ('cancelled' joins paid/rejected).
    if OLD.status::text in ('paid', 'rejected', 'cancelled') then
      raise exception 'This request is already %', OLD.status;
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;
