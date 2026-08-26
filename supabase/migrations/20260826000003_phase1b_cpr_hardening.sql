-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 1b: contractor_payment_requests as a DB-enforced state machine
--
-- contractor_payment_requests is the ONLY surviving money-movement workflow
-- (invoices/payments/POP/budget tables were dropped). Previously any "manager"
-- (is_org_staff OR project-PM) could directly `UPDATE status='approved'|'paid'`,
-- set paid_by to anyone, and edit the amount of an approved request — bypassing
-- the approval engine entirely and with no approver≠payer control. This locks the
-- workflow at the database layer.
--
-- Model:
--   • RLS = who may SEE a row (unchanged, + finance visibility).
--   • Transitions = RPC-only. `requested→approved` via the approvals engine
--     (finalize_approval); `approved→paid` via pay_payment_request();
--     `→rejected` via reject_payment_request(). Every transition sets the
--     transaction-local `app.workflow_ctx` GUC; the guard trigger rejects any
--     change to a protected column unless that GUC matches the row org.
--   • CHECK = illegal *states* unrepresentable (paid identity only in 'paid').
--   • Guard trigger = illegal *transitions* impossible, for every caller incl.
--     the service role (triggers are not bypassed by BYPASSRLS). Direct
--     PostgREST/supabase-js cannot set the GUC, so they cannot bypass.
--
-- SoD enforced: requester(contractor) ≠ approver (existing enforce_approval_sod);
--   approver ≠ payer AND payer ≠ contractor (pay RPC); identities are derived
--   from auth.uid(), never client-supplied. Pay authority = org owner/admin/finance
--   (never a project-PM), so PMs approve and a distinct finance/admin/owner pays.
--
-- DEFERRED (documented, not in this migration):
--   • Distinct-approver-per-step: would deadlock the SHARED approval chain
--     (task plans/extensions too) in orgs where one owner/admin satisfies both
--     steps. Objectives requester≠approver / approver≠payer are already met.
--   • Per-approver monetary ceilings (approval_policies.max_amount_cents).
-- NOTE: amount/invoice are immutable after INSERT (change ⇒ cancel + new request),
--   which is simpler and provably safe (no edit-CPR UI exists).
--
-- Validated against the live schema in a rolled-back transaction: 18/18. 0 rows
-- today → no data migration.
--
-- DEPLOY ORDERING: this migration is ENFORCING. The web pay/reject server actions
-- must call the new RPCs (shipped in the same PR). Deploy the app and this
-- migration together — the old direct-UPDATE actions would be rejected by the guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Value-level invariants: paid identity/time exist only in the paid state ─
alter table public.contractor_payment_requests
  add constraint cpr_paid_by_only_when_paid check (paid_by is null or status = 'paid');
alter table public.contractor_payment_requests
  add constraint cpr_paid_at_only_when_paid check (paid_at is null or status = 'paid');

-- ── 2. finalize_approval — authorise its entity writes via app.workflow_ctx ────
-- Full reproduction of the live engine (20260101006800) + the GUC lines. Self-
-- contained: makes the payment (and every other) requested→approved write pass
-- the new guard. Identical to the Phase 1 change; later migration wins if both merge.
create or replace function public.finalize_approval()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare pend int; rej int; et text; eid uuid;
begin
  et := new.entity_type; eid := new.entity_id;
  if eid is null then return new; end if;
  perform set_config('app.workflow_ctx', new.org_id::text, true);
  select count(*) filter (where decision='pending'), count(*) filter (where decision='rejected')
    into pend, rej from public.approvals where entity_type=et and entity_id=eid;
  if et = 'payment' then
    if rej > 0 then
      update public.contractor_payment_requests set status='rejected', reviewed_at=now(), updated_at=now() where id=eid and status='requested';
    elsif pend = 0 then
      update public.contractor_payment_requests set status='approved', reviewed_at=now(), updated_at=now() where id=eid and status='requested';
    end if;
  elsif et = 'extension' then
    if rej > 0 then
      update public.task_extension_requests set status='rejected', decided_at=now() where id=eid and status='pending';
    elsif pend = 0 then
      update public.task_extension_requests set status='approved', decided_at=now() where id=eid and status='pending';
      update public.tasks t set due_date=e.proposed_due_date, planned_end_date=e.proposed_due_date
        from public.task_extension_requests e where e.id=eid and t.id=e.task_id;
    end if;
  elsif et = 'task_plan' then
    if rej > 0 then update public.tasks set plan_submitted_at=null where id=eid and plan_approved_at is null;
    elsif pend = 0 then
      update public.tasks t set plan_approved_at=now(),
        awarded_cost_cents=coalesce((select sum(s.cost_cents) from public.task_subtasks s where s.task_id=t.id and (s.is_variation=false or s.variation_status='approved')),0)
      where t.id=eid and t.plan_approved_at is null;
    end if;
  elsif et = 'task_variation' then
    if rej > 0 then update public.task_subtasks set variation_status='rejected' where id=eid and variation_status='pending';
    elsif pend = 0 then update public.task_subtasks set variation_status='approved' where id=eid and variation_status='pending'; end if;
  elsif et = 'variation' then
    if rej > 0 then update public.variation_orders set status='rejected', decided_at=now() where id=eid and status not in ('rejected');
    elsif pend = 0 then update public.variation_orders set status='approved', approved_at=now(), decided_at=now() where id=eid and status='submitted'; end if;
  end if;
  perform set_config('app.workflow_ctx','', true);
  return new;
end;
$function$;

-- ── 3. The CPR column guard: RPC-only transitions, immutable scope/amount ──────
create or replace function public.enforce_payment_request_update()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare authorized boolean := current_setting('app.workflow_ctx', true) is not distinct from new.org_id::text;
begin
  -- Absorbing states: paid/rejected rows are frozen.
  if old.status in ('paid','rejected') then
    raise exception 'payment request is already % and cannot be modified', old.status;
  end if;

  -- Immutable payee / scope / amount (change ⇒ new request).
  if new.contractor_id <> old.contractor_id
     or new.task_id is distinct from old.task_id
     or new.project_id <> old.project_id
     or new.org_id <> old.org_id
     or new.amount_cents <> old.amount_cents
     or new.invoice_path is distinct from old.invoice_path
     or new.invoice_name is distinct from old.invoice_name then
    raise exception 'payee/scope/amount of a payment request are immutable; create a new request';
  end if;

  -- Transition / outcome columns are RPC-only (require the workflow context).
  if (new.status <> old.status
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_note is distinct from old.review_note
      or new.paid_by is distinct from old.paid_by
      or new.paid_at is distinct from old.paid_at
      or new.paid_reference is distinct from old.paid_reference
      or new.pop_path is distinct from old.pop_path
      or new.pop_name is distinct from old.pop_name)
     and not authorized then
    raise exception 'workflow fields on a payment request may change only through a payment RPC';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

-- ── 4. pay_payment_request: approved→paid, SoD + authority enforced ───────────
create or replace function public.pay_payment_request(p_id uuid, p_pop_path text, p_pop_name text, p_reference text)
  returns void language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); r public.contractor_payment_requests;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into r from public.contractor_payment_requests where id = p_id;
  if not found then raise exception 'payment request not found'; end if;
  if r.status <> 'approved' then raise exception 'only an approved request can be paid'; end if;
  if not coalesce(public.org_role(r.org_id) in ('owner','admin','finance'), false) then
    raise exception 'not authorised to pay';
  end if;
  if uid = r.contractor_id then raise exception 'you cannot pay your own request'; end if;
  if exists (select 1 from public.approvals where entity_type='payment' and entity_id=p_id and approver_id=uid) then
    raise exception 'an approver of a request may not pay it';
  end if;
  if p_pop_path is null then raise exception 'proof of payment is required'; end if;

  perform set_config('app.workflow_ctx', r.org_id::text, true);
  update public.contractor_payment_requests
    set status='paid', paid_by=uid, paid_at=now(), paid_reference=p_reference, pop_path=p_pop_path, pop_name=p_pop_name
    where id = p_id;
  perform set_config('app.workflow_ctx','', true);

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (r.org_id, uid, 'contractor_payment_request', p_id, 'payment.paid',
          jsonb_build_object('status', r.status::text),
          jsonb_build_object('status','paid','paid_by',uid,'reference',p_reference));
end;
$function$;
revoke all on function public.pay_payment_request(uuid,text,text,text) from public;
grant execute on function public.pay_payment_request(uuid,text,text,text) to authenticated;

-- ── 5. reject_payment_request: requested|approved→rejected ────────────────────
create or replace function public.reject_payment_request(p_id uuid, p_note text)
  returns void language plpgsql security definer set search_path to '' as $function$
declare uid uuid := (select auth.uid()); r public.contractor_payment_requests; is_mgr boolean;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into r from public.contractor_payment_requests where id = p_id;
  if not found then raise exception 'payment request not found'; end if;
  if r.status not in ('requested','approved') then raise exception 'request cannot be rejected in its current state'; end if;
  is_mgr := public.is_org_staff(r.org_id)
            or coalesce(public.project_role(r.project_id)='pm', false)
            or coalesce(public.org_role(r.org_id) in ('owner','admin','finance'), false);
  if not is_mgr then raise exception 'not authorised to reject'; end if;
  if uid = r.contractor_id then raise exception 'you cannot reject your own request'; end if;

  perform set_config('app.workflow_ctx', r.org_id::text, true);
  update public.contractor_payment_requests
    set status='rejected', reviewed_by=uid, reviewed_at=now(), review_note=p_note
    where id = p_id;
  perform set_config('app.workflow_ctx','', true);

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (r.org_id, uid, 'contractor_payment_request', p_id, 'payment.rejected',
          jsonb_build_object('status', r.status::text), jsonb_build_object('status','rejected'));
end;
$function$;
revoke all on function public.reject_payment_request(uuid,text) from public;
grant execute on function public.reject_payment_request(uuid,text) to authenticated;

-- ── 6. Finance visibility: finance users must see CPRs to pay them ────────────
-- (is_org_staff excludes member_type 'finance', so add an explicit finance clause.)
drop policy if exists cpr_select on public.contractor_payment_requests;
create policy cpr_select on public.contractor_payment_requests for select using (
  (select public.is_org_staff(org_id))
  or (select public.project_role(project_id)) = 'pm'
  or contractor_id = (select auth.uid())
  or coalesce((select public.org_role(org_id)) = 'finance', false)
);
