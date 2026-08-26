-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — service/system member-change audit regression test
--
-- Same psql/pg_temp harness; one transaction, rolled back. Requires migrations
-- through 20260825000006. Validated against the live schema: 5/5.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/audit_service_member_changes.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;

insert into auth.users (id,email) values
 ('e0000000-0000-0000-0000-000000000000','own@a.dev'),('a0000000-0000-0000-0000-000000000000','adm@a.dev'),
 ('11110000-0000-0000-0000-000000000000','m1@a.dev'),('22220000-0000-0000-0000-000000000000','m2@a.dev');
insert into public.organizations (id,name,require_mfa) values ('a1110000-0000-0000-0000-000000000000','Oa',false);
insert into public.org_members (org_id,user_id,role,member_type,status) values
 ('a1110000-0000-0000-0000-000000000000','e0000000-0000-0000-0000-000000000000','owner','owner','active'),
 ('a1110000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-000000000000','admin','admin','active'),
 ('a1110000-0000-0000-0000-000000000000','11110000-0000-0000-0000-000000000000','member','staff','active'),
 ('a1110000-0000-0000-0000-000000000000','22220000-0000-0000-0000-000000000000','member','staff','active');

-- 1. Service-role role change (the admin-adapter path) is audited, actor null.
update public.org_members set role='pm', member_type='pm'
  where org_id='a1110000-0000-0000-0000-000000000000' and user_id='11110000-0000-0000-0000-000000000000';
select pg_temp.ok(
  exists(select 1 from public.audit_logs where entity_id='11110000-0000-0000-0000-000000000000'
         and action='member.role_changed' and actor_id is null and after->>'role'='pm' and after->>'actor_kind'='service'),
  '1: service role change audited (member.role_changed, actor null, actor_kind=service)');

-- 2. Service-role disable is audited.
update public.org_members set status='disabled'
  where org_id='a1110000-0000-0000-0000-000000000000' and user_id='11110000-0000-0000-0000-000000000000';
select pg_temp.ok(
  exists(select 1 from public.audit_logs where entity_id='11110000-0000-0000-0000-000000000000' and action='member.disabled' and actor_id is null),
  '2: service disable audited (member.disabled)');

-- 3. Service-role re-enable is audited.
update public.org_members set status='active'
  where org_id='a1110000-0000-0000-0000-000000000000' and user_id='11110000-0000-0000-0000-000000000000';
select pg_temp.ok(
  exists(select 1 from public.audit_logs where entity_id='11110000-0000-0000-0000-000000000000' and action='member.enabled' and actor_id is null),
  '3: service enable audited (member.enabled)');

-- 4. A user-attributed change (admin, JWT set) is NOT double-audited by the trigger.
set role authenticated; set request.jwt.claims='{"sub":"a0000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}';
update public.org_members set role='pm', member_type='pm'
  where org_id='a1110000-0000-0000-0000-000000000000' and user_id='22220000-0000-0000-0000-000000000000';
reset role; reset request.jwt.claims;
select pg_temp.ok(
  (select count(*) from public.audit_logs where entity_id='22220000-0000-0000-0000-000000000000' and action='member.role_changed')=0,
  '4: user-attributed change is not double-audited by the trigger');

-- 5. A no-op update (unchanged privilege fields) produces no audit.
update public.org_members set role='pm'
  where org_id='a1110000-0000-0000-0000-000000000000' and user_id='22220000-0000-0000-0000-000000000000';
select pg_temp.ok(
  (select count(*) from public.audit_logs where entity_id='22220000-0000-0000-0000-000000000000' and action in ('member.role_changed','member.updated'))=0,
  '5: unchanged privilege fields produce no audit');

rollback;
