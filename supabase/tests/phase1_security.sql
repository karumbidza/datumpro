-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 1 workflow-transition regression tests
--
-- Proves the approval-outcome columns can change only via the sanctioned
-- transition path (finalize_approval), never a generic UPDATE. Same psql/pg_temp
-- harness as phase0_security.sql; one transaction, rolled back.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase1_security.sql
--
-- Requires migrations through 20260825000002 applied. Validated against the live
-- schema in a rolled-back transaction: 8/8 assertions pass.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS: %', label;
  else raise exception 'FAIL: %', label;
  end if;
end $$;

-- Runs p_sql; PASSES only if it raises (DB blocked it).
create or replace function pg_temp.expect_fail(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin execute p_sql; perform pg_temp.ok(false, p_label || ' — expected the DB to reject it');
  exception when others then perform pg_temp.ok(true, p_label);
  end;
end $$;

-- Runs p_sql; PASSES only if it succeeds (guards against over-blocking).
create or replace function pg_temp.expect_ok(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin execute p_sql; perform pg_temp.ok(true, p_label);
  exception when others then perform pg_temp.ok(false, p_label || ' — expected success, got: ' || sqlerrm);
  end;
end $$;

-- ── Seed (as superuser, RLS bypassed) ────────────────────────────────────────
insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222','admin@p1.dev');
insert into public.organizations (id, name, require_mfa) values
  ('aaaa1111-0000-0000-0000-000000000000','Org P1', false);
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('aaaa1111-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','owner','owner','active');
insert into public.projects (id, org_id, name) values
  ('aaaa2222-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','Proj');
insert into public.tasks (id, org_id, project_id, title) values
  ('aaaa3333-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','aaaa2222-0000-0000-0000-000000000000','Task');
insert into public.task_subtasks (id, org_id, task_id, title, is_variation, variation_status) values
  ('aaaa4444-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','aaaa3333-0000-0000-0000-000000000000','SubA', true, 'pending');
insert into public.task_extension_requests (id, org_id, project_id, task_id, proposed_due_date, status) values
  ('aaaa5555-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','aaaa2222-0000-0000-0000-000000000000','aaaa3333-0000-0000-0000-000000000000', now() + interval '10 days', 'pending');

-- ── Direct writes to guarded columns are blocked (no workflow context) ───────
select pg_temp.expect_fail($$ update public.tasks set plan_approved_at = now() where id='aaaa3333-0000-0000-0000-000000000000' $$,
  'P1-1: direct write to tasks.plan_approved_at is blocked');
select pg_temp.expect_fail($$ update public.task_subtasks set variation_status='approved' where id='aaaa4444-0000-0000-0000-000000000000' $$,
  'P1-2: direct write to task_subtasks.variation_status is blocked');
select pg_temp.expect_fail($$ update public.task_extension_requests set status='approved' where id='aaaa5555-0000-0000-0000-000000000000' $$,
  'P1-3: direct write to task_extension_requests.status is blocked');

-- ── Non-protected columns remain updatable ───────────────────────────────────
select pg_temp.expect_ok($$ update public.tasks set title='Task b' where id='aaaa3333-0000-0000-0000-000000000000' $$,
  'P1-4: non-protected tasks.title is still updatable');
select pg_temp.expect_ok($$ update public.task_subtasks set title='SubA b' where id='aaaa4444-0000-0000-0000-000000000000' $$,
  'P1-5: non-protected task_subtasks.title is still updatable');

-- ── The workflow context authorises only the matching org ────────────────────
select set_config('app.workflow_ctx','aaaa1111-0000-0000-0000-000000000000', true);
select pg_temp.expect_ok($$ update public.tasks set plan_approved_at = now() where id='aaaa3333-0000-0000-0000-000000000000' $$,
  'P1-6: guarded column ALLOWED when app.workflow_ctx matches the row org');
select set_config('app.workflow_ctx','', true);

select set_config('app.workflow_ctx','bbbb9999-0000-0000-0000-000000000000', true);
select pg_temp.expect_fail($$ update public.task_subtasks set variation_status='approved' where id='aaaa4444-0000-0000-0000-000000000000' $$,
  'P1-7: a mismatched-org workflow_ctx does not authorise the write');
select set_config('app.workflow_ctx','', true);

-- ── End-to-end: finalize_approval approves the extension THROUGH the guard ───
-- (An extension insert auto-seeds pending steps; clear them and record a single
--  approved step so the whole chain is decided and finalize_approval fires.)
delete from public.approvals where entity_type='extension' and entity_id='aaaa5555-0000-0000-0000-000000000000';
insert into public.approvals (org_id, entity_type, entity_id, step_order, approver_role, decision, approver_id)
  values ('aaaa1111-0000-0000-0000-000000000000','extension','aaaa5555-0000-0000-0000-000000000000',1,'admin','approved','22222222-2222-2222-2222-222222222222');
select pg_temp.ok(
  (select status::text from public.task_extension_requests where id='aaaa5555-0000-0000-0000-000000000000') = 'approved',
  'P1-8: finalize_approval sets extension status=approved through the guard');

rollback;
