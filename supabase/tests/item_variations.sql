-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — item-level variation wiring regression test
--
-- PM→finance approval, reason codes, and the approved-vs-actual variance view.
-- Same psql/pg_temp harness; one transaction, rolled back. Requires migrations
-- through 20260825000005. Validated against the live schema: 7/7.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/item_variations.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;

-- 1. Existing variation second step migrated admin → finance.
select pg_temp.ok(
  (select count(*) from public.approval_policies where entity_type='task_variation' and step_order=2 and approver_role='admin') = 0,
  '1: existing task_variation step2 moved admin→finance');

-- A fresh org seeds variation on finance, payment on admin.
insert into auth.users (id,email) values
 ('e0000000-0000-0000-0000-000000000000','own@v.dev'),('b0000000-0000-0000-0000-000000000000','pm@v.dev'),
 ('f0000000-0000-0000-0000-000000000000','fin@v.dev'),('c0000000-0000-0000-0000-000000000000','con@v.dev');
set role authenticated; set request.jwt.claims='{"sub":"e0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
insert into public.organizations (id,name,require_mfa) values ('a1110000-0000-0000-0000-000000000000','Ov',false);
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select approver_role::text from public.approval_policies where org_id='a1110000-0000-0000-0000-000000000000' and entity_type='task_variation' and step_order=2)='finance'
  and (select approver_role::text from public.approval_policies where org_id='a1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order=2)='admin',
  '2: new org seeds task_variation pm→finance, payment pm→admin');

-- Reconfigure keeps variations on finance.
set role authenticated; set request.jwt.claims='{"sub":"e0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select public.set_org_approval_policy('a1110000-0000-0000-0000-000000000000','admin');
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select approver_role::text from public.approval_policies where org_id='a1110000-0000-0000-0000-000000000000' and entity_type='task_variation' and step_order=2)='finance',
  '3: set_org_approval_policy keeps task_variation→finance');

-- Full flow: locked task, raise a variation with a reason code, PM→finance approve.
insert into public.org_members (org_id,user_id,role,member_type,status) values
 ('a1110000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000000','pm','pm','active'),
 ('a1110000-0000-0000-0000-000000000000','f0000000-0000-0000-0000-000000000000','finance','finance','active'),
 ('a1110000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','member','contractor','active');
insert into public.projects (id,org_id,name) values ('a2220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','P');
insert into public.project_members (org_id,project_id,user_id,role) values ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','contractor');
insert into public.tasks (id,org_id,project_id,title,assignee_id) values ('a3330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','T','c0000000-0000-0000-0000-000000000000');
insert into public.task_subtasks (id,org_id,task_id,title,cost_cents,created_by) values ('a4440000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','base',8000,'c0000000-0000-0000-0000-000000000000');
-- Simulate the app's approved lock. plan_approved_at is guarded
-- (guard_workflow_transition) — authorise this fixture write, then clear the GUC
-- so any later guard checks are enforced. See docs/DB-WORKFLOW-GUARDS.md.
select set_config('app.workflow_ctx','a1110000-0000-0000-0000-000000000000', true);
update public.tasks set plan_approved_at=now(), awarded_cost_cents=8000 where id='a3330000-0000-0000-0000-000000000000';
select set_config('app.workflow_ctx','', true);
insert into public.task_subtasks (id,org_id,task_id,title,cost_cents,created_by,variation_reason_code,variation_reason)
  values ('a4450000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','extra',2000,'c0000000-0000-0000-0000-000000000000','site_condition','rock encountered');
select pg_temp.ok(
  (select is_variation from public.task_subtasks where id='a4450000-0000-0000-0000-000000000000')=true
  and (select variation_reason_code from public.task_subtasks where id='a4450000-0000-0000-0000-000000000000')='site_condition',
  '4: new line auto-flagged as a variation + reason code stored');
select pg_temp.ok(
  (select string_agg(approver_role::text,'→' order by step_order) from public.approvals where entity_type='task_variation' and entity_id='a4450000-0000-0000-0000-000000000000')='pm→finance',
  '5: variation approval chain seeded pm→finance');
update public.approvals set decision='approved', approver_id='b0000000-0000-0000-0000-000000000000' where entity_type='task_variation' and entity_id='a4450000-0000-0000-0000-000000000000' and step_order=1;
update public.approvals set decision='approved', approver_id='f0000000-0000-0000-0000-000000000000' where entity_type='task_variation' and entity_id='a4450000-0000-0000-0000-000000000000' and step_order=2;
select pg_temp.ok(
  (select variation_status from public.task_subtasks where id='a4450000-0000-0000-0000-000000000000')='approved'
  and (select awarded_cost_cents from public.tasks where id='a3330000-0000-0000-0000-000000000000')=10000,
  '6: finance approval finalizes the variation; locked price 8000→10000');
select pg_temp.ok(
  (select baseline_cost_cents from public.task_cost_variance where task_id='a3330000-0000-0000-0000-000000000000')=8000
  and (select approved_variation_cents from public.task_cost_variance where task_id='a3330000-0000-0000-0000-000000000000')=2000
  and (select actual_cost_cents from public.task_cost_variance where task_id='a3330000-0000-0000-0000-000000000000')=10000,
  '7: task_cost_variance view: baseline 8000, variation 2000, actual 10000');

rollback;
