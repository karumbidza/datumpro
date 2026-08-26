-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 1b: contractor_payment_requests state-machine regression tests
--
-- Same psql/pg_temp harness as phase0/1; one transaction, rolled back. Requires
-- migrations through 20260825000003. Validated against the live schema: 18/18.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase1b_security.sql
--
-- Every assertion proves the DB (not the UI) enforces the rule.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;
create or replace function pg_temp.efail(p_sql text, p_label text) returns void language plpgsql as $$
begin begin execute p_sql; perform pg_temp.ok(false, p_label || ' — expected the DB to reject it');
  exception when others then perform pg_temp.ok(true, p_label); end; end $$;
create or replace function pg_temp.eok(p_sql text, p_label text) returns void language plpgsql as $$
begin begin execute p_sql; perform pg_temp.ok(true, p_label);
  exception when others then perform pg_temp.ok(false, p_label || ' — expected success, got: ' || sqlerrm); end; end $$;

-- ── Seed: org with owner/admin/pm/finance/member + contractor; approved task ──
insert into auth.users (id,email) values
 ('c0000000-0000-0000-0000-000000000000','c@1b.dev'),('b0000000-0000-0000-0000-000000000000','pm@1b.dev'),
 ('a0000000-0000-0000-0000-000000000000','admin@1b.dev'),('f0000000-0000-0000-0000-000000000000','fin@1b.dev'),
 ('d0000000-0000-0000-0000-000000000000','mem@1b.dev'),('e0000000-0000-0000-0000-000000000000','own@1b.dev');
insert into public.organizations (id,name,require_mfa) values ('a1110000-0000-0000-0000-000000000000','O1b',false);
insert into public.org_members (org_id,user_id,role,member_type,status) values
 ('a1110000-0000-0000-0000-000000000000','e0000000-0000-0000-0000-000000000000','owner','owner','active'),
 ('a1110000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-000000000000','admin','admin','active'),
 ('a1110000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000000','pm','pm','active'),
 ('a1110000-0000-0000-0000-000000000000','f0000000-0000-0000-0000-000000000000','finance','finance','active'),
 ('a1110000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000000','member','staff','active'),
 ('a1110000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','member','contractor','active');
insert into public.projects (id,org_id,name) values ('a2220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','P');
insert into public.project_members (org_id,project_id,user_id,role) values
 ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','contractor');
insert into public.tasks (id,org_id,project_id,title,assignee_id,plan_approved_at,awarded_cost_cents)
  values ('a3330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','T','c0000000-0000-0000-0000-000000000000', now(), 100000);
insert into public.approval_policies (org_id,entity_type,step_order,approver_role,min_amount_cents) values
 ('a1110000-0000-0000-0000-000000000000','payment',1,'pm',0),('a1110000-0000-0000-0000-000000000000','payment',2,'admin',0);
insert into public.contractor_payment_requests (id,org_id,project_id,task_id,contractor_id,title,amount_cents,invoice_path,status)
  values ('aaaa0001-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','A',10000,'inv/a.pdf','requested');
insert into public.contractor_payment_requests (id,org_id,project_id,task_id,contractor_id,title,amount_cents,invoice_path,status)
  values ('aaaa0002-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','B',10000,'inv/b.pdf','requested');

-- ── requested-state: direct writes & immutability blocked (run as superuser) ──
select pg_temp.efail($$ update public.contractor_payment_requests set status='approved' where id='aaaa0001-0000-0000-0000-000000000000' $$,'1: direct status→approved blocked (bypass)');
select pg_temp.efail($$ update public.contractor_payment_requests set status='paid', paid_by='a0000000-0000-0000-0000-000000000000' where id='aaaa0001-0000-0000-0000-000000000000' $$,'2: direct status→paid blocked (bypass)');
select pg_temp.efail($$ update public.contractor_payment_requests set contractor_id='d0000000-0000-0000-0000-000000000000' where id='aaaa0001-0000-0000-0000-000000000000' $$,'3: change payee blocked (immutable)');
select pg_temp.efail($$ update public.contractor_payment_requests set amount_cents=99999 where id='aaaa0001-0000-0000-0000-000000000000' $$,'4: change amount blocked (immutable)');
select pg_temp.eok($$ update public.contractor_payment_requests set title='A2' where id='aaaa0001-0000-0000-0000-000000000000' $$,'5: non-protected title still editable');

-- ── pay before approval → blocked ──
set role authenticated; set request.jwt.claims='{"sub":"f0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/a','a','ref') $$,'6: pay when not approved blocked');
reset role; reset request.jwt.claims;

-- ── approve via the engine (two distinct approvers) → finalize sets approved ──
update public.approvals set decision='approved', approver_id='b0000000-0000-0000-0000-000000000000' where entity_type='payment' and entity_id='aaaa0001-0000-0000-0000-000000000000' and step_order=1;
update public.approvals set decision='approved', approver_id='a0000000-0000-0000-0000-000000000000' where entity_type='payment' and entity_id='aaaa0001-0000-0000-0000-000000000000' and step_order=2;
select pg_temp.ok((select status::text from public.contractor_payment_requests where id='aaaa0001-0000-0000-0000-000000000000')='approved','7: finalize_approval set status=approved through the guard');

-- ── pay authorisation + SoD ──
set role authenticated; set request.jwt.claims='{"sub":"c0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/a','a','ref') $$,'8: contractor cannot pay (payer≠requester)');
set request.jwt.claims='{"sub":"d0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/a','a','ref') $$,'9: ordinary member cannot pay (no authority)');
set request.jwt.claims='{"sub":"a0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/a','a','ref') $$,'10: approver cannot pay (approver≠payer)');
set request.jwt.claims='{"sub":"f0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000',null,null,'ref') $$,'11: pay without POP blocked');
select pg_temp.eok($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/a','popA','ref-123') $$,'12: finance (non-approver) pays successfully');
reset role; reset request.jwt.claims;
select pg_temp.ok((select paid_by from public.contractor_payment_requests where id='aaaa0001-0000-0000-0000-000000000000')='f0000000-0000-0000-0000-000000000000','13: paid_by bound to the payer auth.uid()');
select pg_temp.ok(exists(select 1 from public.audit_logs where entity_id='aaaa0001-0000-0000-0000-000000000000' and action='payment.paid'),'14: pay writes a DB audit event');

-- ── paid is absorbing ──
select pg_temp.efail($$ update public.contractor_payment_requests set status='approved' where id='aaaa0001-0000-0000-0000-000000000000' $$,'15: paid is terminal (direct)');
set role authenticated; set request.jwt.claims='{"sub":"f0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ select public.pay_payment_request('aaaa0001-0000-0000-0000-000000000000','pop/x','x','y') $$,'16: cannot re-pay a paid request');
reset role; reset request.jwt.claims;

-- ── reject flow (manager) ──
set role authenticated; set request.jwt.claims='{"sub":"a0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.eok($$ select public.reject_payment_request('aaaa0002-0000-0000-0000-000000000000','not eligible') $$,'17: manager rejects via RPC');
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select status::text from public.contractor_payment_requests where id='aaaa0002-0000-0000-0000-000000000000')='rejected'
  and exists(select 1 from public.audit_logs where entity_id='aaaa0002-0000-0000-0000-000000000000' and action='payment.rejected'),
  '18: reject sets status=rejected + writes audit');

rollback;
