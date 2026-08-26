-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 1 (draft): database-enforced workflow transitions
--
-- Goal: approval-outcome columns can change ONLY through the sanctioned
-- transition path (the approvals engine's finalize_approval trigger), never via a
-- generic UPDATE. This closes the "privileged role stamps an approval directly"
-- bypass at the database layer, for every caller including the service role.
--
-- Mechanism (mirrors the Phase 0 grant_owner pattern):
--   • A transaction-local GUC `app.workflow_ctx` is set to the entity's org_id
--     ONLY inside vetted SECURITY DEFINER code (here: finalize_approval).
--   • A generic BEFORE UPDATE guard rejects any change to its protected
--     column(s) unless that GUC matches the row's org_id. It fires only when a
--     protected column actually changes, so ordinary updates are unaffected.
--
-- SCOPE NOTE (important — the live schema differs from the original Phase 1 plan):
--   The `requests`, `invoices`, `payments`, `proof_of_payments`, `budget_lines`
--   and `paynow_transactions` tables were DROPPED by 20260101006600 — the
--   finance/invoicing workflows the original plan targeted no longer exist.
--   The live approvals-engine entities are: task_plan (tasks.plan_approved_at),
--   task_variation (task_subtasks.variation_status), extension
--   (task_extension_requests.status), and payment
--   (contractor_payment_requests.status). This migration locks the first three —
--   whose outcome columns are written ONLY by finalize_approval, so the change is
--   non-breaking. Deliberately deferred (need app-caller repointing first):
--     • contractor_payment_requests — its approved→paid / →rejected transitions
--       are still written directly by apps/web/.../payments/request-actions.ts.
--     • boq_tenders.unsealed_at / awarded_bidder_id — already RPC-gated
--       (unseal_tender / award_boq_tender); guarding them requires those RPCs to
--       set the GUC. A small follow-up.
--     • variation_orders — vestigial: never wired to the approvals engine (no
--       seeding) and not written by any app action. Recommend either wiring a
--       submit+seed flow or removing the table; not guarded here so we don't
--       freeze it ambiguously.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Generic guard: protected columns (passed as trigger args) may change only
--    when app.workflow_ctx equals the row's org_id (set by finalize_approval). ──
create or replace function public.guard_workflow_transition()
returns trigger language plpgsql set search_path = '' as $$
declare
  col     text;
  changed boolean := false;
  oldj    jsonb := to_jsonb(old);
  newj    jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if (oldj ->> col) is distinct from (newj ->> col) then
      changed := true;
      exit;
    end if;
  end loop;

  if not changed then
    return new;  -- no protected column touched → ordinary update, allow
  end if;

  -- Sanctioned transition context for THIS org?
  if current_setting('app.workflow_ctx', true) is not distinct from (newj ->> 'org_id') then
    return new;
  end if;

  raise exception
    'protected workflow column(s) [%] on % may change only via an approved transition',
    array_to_string(tg_argv, ', '), tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.guard_workflow_transition() from public;

-- ── finalize_approval: authorise its entity writes by setting the GUC ─────────
-- Verbatim reproduction of the live version (20260101006800) with two added
-- set_config lines. It is the sole sanctioned writer of the guarded columns.
create or replace function public.finalize_approval()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := new.entity_type;
  eid := new.entity_id;
  if eid is null then return new; end if;

  -- Phase 1: authorise the protected-column writes below for this entity's org.
  perform set_config('app.workflow_ctx', new.org_id::text, true);

  select count(*) filter (where decision = 'pending'),
         count(*) filter (where decision = 'rejected')
    into pend, rej
  from public.approvals
  where entity_type = et and entity_id = eid;

  if et = 'variation' then
    if rej > 0 then
      update public.variation_orders set status = 'rejected', decided_at = now()
        where id = eid and status not in ('rejected');
    elsif pend = 0 then
      update public.variation_orders set status = 'approved', approved_at = now(), decided_at = now()
        where id = eid and status = 'submitted';
    end if;
  elsif et = 'extension' then
    if rej > 0 then
      update public.task_extension_requests set status = 'rejected', decided_at = now()
        where id = eid and status = 'pending';
    elsif pend = 0 then
      update public.task_extension_requests set status = 'approved', decided_at = now()
        where id = eid and status = 'pending';
      update public.tasks t
        set due_date = e.proposed_due_date, planned_end_date = e.proposed_due_date
        from public.task_extension_requests e
        where e.id = eid and t.id = e.task_id;
    end if;
  elsif et = 'payment' then
    if rej > 0 then
      update public.contractor_payment_requests set status = 'rejected', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    elsif pend = 0 then
      update public.contractor_payment_requests set status = 'approved', reviewed_at = now(), updated_at = now()
        where id = eid and status = 'requested';
    end if;
  elsif et = 'task_plan' then
    if rej > 0 then
      update public.tasks set plan_submitted_at = null
        where id = eid and plan_approved_at is null;
    elsif pend = 0 then
      update public.tasks t set
        plan_approved_at   = now(),
        awarded_cost_cents = coalesce((
          select sum(s.cost_cents) from public.task_subtasks s
          where s.task_id = t.id
            and (s.is_variation = false or s.variation_status = 'approved')
        ), 0)
      where t.id = eid and t.plan_approved_at is null;
    end if;
  elsif et = 'task_variation' then
    if rej > 0 then
      update public.task_subtasks set variation_status = 'rejected'
        where id = eid and variation_status = 'pending';
    elsif pend = 0 then
      update public.task_subtasks set variation_status = 'approved'
        where id = eid and variation_status = 'pending';
      update public.tasks t set awarded_cost_cents = coalesce((
        select sum(s.cost_cents) from public.task_subtasks s
        where s.task_id = t.id
          and (s.is_variation = false or s.variation_status = 'approved')
      ), 0)
      from public.task_subtasks v
      where v.id = eid and t.id = v.task_id;
    end if;
  end if;

  perform set_config('app.workflow_ctx', '', true);  -- close the window
  return new;
end;
$function$;

-- ── Install guards on the finalize-only approval-outcome columns ──────────────
drop trigger if exists trg_guard_plan_approval on public.tasks;
create trigger trg_guard_plan_approval before update on public.tasks
  for each row execute function public.guard_workflow_transition('plan_approved_at');

drop trigger if exists trg_guard_variation_status on public.task_subtasks;
create trigger trg_guard_variation_status before update on public.task_subtasks
  for each row execute function public.guard_workflow_transition('variation_status');

drop trigger if exists trg_guard_extension_status on public.task_extension_requests;
create trigger trg_guard_extension_status before update on public.task_extension_requests
  for each row execute function public.guard_workflow_transition('status');
