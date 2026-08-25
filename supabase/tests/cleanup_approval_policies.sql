-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — orphaned approval_policies cleanup regression test
--
-- Verifies request/variation policies are gone and neither seeder re-creates them.
-- Same psql/pg_temp harness; one transaction, rolled back. Requires migrations
-- through 20260825000004. Validated against the live schema: 4/4.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cleanup_approval_policies.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;

-- 1. No request/variation policies remain anywhere.
select pg_temp.ok(
  (select count(*) from public.approval_policies where entity_type in ('request','variation')) = 0,
  '1: no request/variation policies remain');

-- 2. Wired entity types are untouched.
select pg_temp.ok(
  (select count(*) from public.approval_policies where entity_type='payment') > 0
  and (select count(*) from public.approval_policies where entity_type='task_plan') > 0,
  '2: wired policies (payment/task_plan) untouched');

-- 3. A new org seeds only the 4 live entity types.
insert into auth.users (id,email) values ('99990000-0000-0000-0000-000000000000','cleanup@t.dev');
set role authenticated;
set request.jwt.claims = '{"sub":"99990000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
insert into public.organizations (id,name,require_mfa) values ('99991111-0000-0000-0000-000000000000','CleanupOrg',false);
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select string_agg(distinct entity_type, ',' order by entity_type)
     from public.approval_policies where org_id='99991111-0000-0000-0000-000000000000')
    = 'extension,payment,task_plan,task_variation',
  '3: new org seeds only the 4 live entity types');

-- 4. Reconfigure (set_org_approval_policy) also seeds only the 4 live types.
set role authenticated;
set request.jwt.claims = '{"sub":"99990000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select public.set_org_approval_policy('99991111-0000-0000-0000-000000000000','admin');
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select count(*) from public.approval_policies
     where org_id='99991111-0000-0000-0000-000000000000' and entity_type in ('request','variation')) = 0,
  '4: set_org_approval_policy no longer re-creates request/variation');

rollback;
