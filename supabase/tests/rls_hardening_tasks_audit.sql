-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — RLS hardening regression test (tasks_update WITH CHECK + audit read)
--
-- Same psql/pg_temp harness; one transaction, rolled back. Requires migrations
-- through 20260825000007. Validated against the live schema: 6/6.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_hardening_tasks_audit.sql
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

insert into auth.users (id,email) values
 ('e0000000-0000-0000-0000-000000000000','o@t.dev'),('b0000000-0000-0000-0000-000000000000','p@t.dev'),
 ('c0000000-0000-0000-0000-000000000000','c@t.dev'),('d0000000-0000-0000-0000-000000000000','d@t.dev'),
 ('f0000000-0000-0000-0000-000000000000','f@t.dev'),('11110000-0000-0000-0000-000000000000','m@t.dev');
insert into public.organizations (id,name,require_mfa) values ('a1110000-0000-0000-0000-000000000000','O',false);
insert into public.org_members (org_id,user_id,role,member_type,status) values
 ('a1110000-0000-0000-0000-000000000000','e0000000-0000-0000-0000-000000000000','owner','owner','active'),
 ('a1110000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000000','member','staff','active'),
 ('a1110000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','member','staff','active'),
 ('a1110000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000000','member','staff','active'),
 ('a1110000-0000-0000-0000-000000000000','f0000000-0000-0000-0000-000000000000','finance','finance','active'),
 ('a1110000-0000-0000-0000-000000000000','11110000-0000-0000-0000-000000000000','member','staff','active');
insert into public.projects (id,org_id,name) values ('a2220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','P');
insert into public.project_members (org_id,project_id,user_id,role) values
 ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000000','pm'),
 ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000','contributor'),
 ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000000','contributor');
insert into public.tasks (id,org_id,project_id,title,assignee_id) values ('a3330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','T','c0000000-0000-0000-0000-000000000000');
insert into public.audit_logs (org_id,actor_id,entity_type,entity_id,action) values ('a1110000-0000-0000-0000-000000000000',null,'test','a3330000-0000-0000-0000-000000000000','test.event');

-- M2 — tasks_update WITH CHECK
set role authenticated; set request.jwt.claims='{"sub":"c0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.efail($$ update public.tasks set assignee_id='d0000000-0000-0000-0000-000000000000' where id='a3330000-0000-0000-0000-000000000000' $$,'M2-1: non-manager assignee cannot reassign the task');
select pg_temp.eok($$ update public.tasks set blocker_description='stuck' where id='a3330000-0000-0000-0000-000000000000' $$,'M2-2: assignee can still update their own task');
reset role; reset request.jwt.claims;
set role authenticated; set request.jwt.claims='{"sub":"b0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.eok($$ update public.tasks set assignee_id='d0000000-0000-0000-0000-000000000000' where id='a3330000-0000-0000-0000-000000000000' $$,'M2-3: manager (project PM) can reassign');
reset role; reset request.jwt.claims;

-- M3 — audit read
set role authenticated; set request.jwt.claims='{"sub":"f0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.audit_logs where org_id='a1110000-0000-0000-0000-000000000000')>=1,'M3-1: finance can read the org audit log');
set request.jwt.claims='{"sub":"11110000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.audit_logs where org_id='a1110000-0000-0000-0000-000000000000')=0,'M3-2: plain member still cannot read the audit log');
set request.jwt.claims='{"sub":"e0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.audit_logs where org_id='a1110000-0000-0000-0000-000000000000')>=1,'M3-3: owner/admin can still read the audit log');
reset role; reset request.jwt.claims;

rollback;
