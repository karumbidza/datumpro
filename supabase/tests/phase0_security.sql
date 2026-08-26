-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 0 security regression tests
--
-- Proves, at the DATABASE layer, the two Phase 0 invariants:
--   0A  Admin → Owner privilege escalation is impossible.
--   0B  A row's org_id (tenant identity) cannot change after creation.
--
-- Style matches supabase/tests/rls_security.sql: one transaction that ROLLBACKs,
-- every assertion prints `PASS: …`, the first failure raises and (with
-- ON_ERROR_STOP=1) exits non-zero — CI-gateable. Run against a DB with ALL
-- migrations (including 20260825000000/1) applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase0_security.sql
--
-- Every test asserts the DB rejects the operation — never that the UI hides it.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

-- ── Assertion helpers (session-temp) ─────────────────────────────────────────
create or replace function pg_temp.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS: %', label;
  else raise exception 'FAIL: %', label;
  end if;
end $$;

-- Runs p_sql and PASSES only if it raises (i.e. the DB blocked it).
create or replace function pg_temp.expect_fail(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ok(false, p_label || ' — expected the DB to reject it, but it succeeded');
  exception when others then
    perform pg_temp.ok(true, p_label);
  end;
end $$;

-- Runs p_sql and PASSES only if it succeeds (guards against over-blocking).
create or replace function pg_temp.expect_ok(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ok(true, p_label);
  exception when others then
    perform pg_temp.ok(false, p_label || ' — expected success, got: ' || sqlerrm);
  end;
end $$;

-- ── Seed (as superuser, RLS bypassed) ────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner-a@p0.dev'),
  ('22222222-2222-2222-2222-222222222222','admin-a@p0.dev'),
  ('33333333-3333-3333-3333-333333333333','member-a@p0.dev'),
  ('44444444-4444-4444-4444-444444444444','target-a@p0.dev'),
  ('55555555-5555-5555-5555-555555555555','contractor-a@p0.dev'),
  ('66666666-6666-6666-6666-666666666666','viewer-a@p0.dev'),
  ('99999999-9999-9999-9999-999999999999','client-a@p0.dev'),
  ('77777777-7777-7777-7777-777777777777','newuser-a@p0.dev'),
  ('88888888-8888-8888-8888-888888888888','owner-b@p0.dev');

insert into public.organizations (id, name, require_mfa) values
  ('aaaa1111-0000-0000-0000-000000000000','Org A', false),
  ('bbbb1111-0000-0000-0000-000000000000','Org B', false);

-- One owner per org first (trigger bootstrap allows the first owner), then the rest.
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('aaaa1111-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','owner','owner','active'),
  ('bbbb1111-0000-0000-0000-000000000000','88888888-8888-8888-8888-888888888888','owner','owner','active'),
  ('aaaa1111-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','admin','admin','active'),
  ('aaaa1111-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','member','staff','active'),
  ('aaaa1111-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','member','staff','active'),
  ('aaaa1111-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','member','contractor','active'),
  ('aaaa1111-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666','viewer','viewer','active'),
  ('aaaa1111-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999','viewer','client','active');

insert into public.projects (id, org_id, name) values
  ('aaaa2222-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','Project A');

-- Convenience: a JWT-claims literal builder is inlined per section below.

-- ═════════════════════════════════════════════════════════════════════════════
-- PHASE 0A — OWNER ESCALATION
-- ═════════════════════════════════════════════════════════════════════════════

-- ── As Administrator (ad1) ───────────────────────────────────────────────────
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}';

-- Control: admin CAN create an ordinary (non-owner) invitation.
select pg_temp.expect_ok($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','new-staff@p0.dev','member','staff','tok-ctl-1','pending')
$$, 'CONTROL: admin can create a non-owner invitation');

-- TEST 1: admin cannot create an owner-role invitation.
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','evil@p0.dev','owner','staff','tok-ev-1','pending')
$$, 'T1: admin cannot create role=owner invitation');

-- TEST 2: admin cannot create a member_type=owner invitation.
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','evil2@p0.dev','admin','owner','tok-ev-2','pending')
$$, 'T2: admin cannot create member_type=owner invitation');

-- TEST 3: admin cannot mutate an existing invitation into owner after creation.
select pg_temp.expect_fail($$
  update public.org_invitations set role = 'owner' where token = 'tok-ctl-1'
$$, 'T3a: admin cannot UPDATE invitation role to owner');
select pg_temp.expect_fail($$
  update public.org_invitations set member_type = 'owner' where token = 'tok-ctl-1'
$$, 'T3b: admin cannot UPDATE invitation member_type to owner');

-- TEST 5: admin cannot update THEIR OWN membership to owner.
select pg_temp.expect_fail($$
  update public.org_members set role = 'owner'
   where org_id = 'aaaa1111-0000-0000-0000-000000000000'
     and user_id = '22222222-2222-2222-2222-222222222222'
$$, 'T5: admin cannot UPDATE self to owner');

-- TEST 6: admin cannot update ANOTHER member to owner.
select pg_temp.expect_fail($$
  update public.org_members set role = 'owner'
   where org_id = 'aaaa1111-0000-0000-0000-000000000000'
     and user_id = '33333333-3333-3333-3333-333333333333'
$$, 'T6: admin cannot UPDATE another member to owner');

-- TEST 16: admin cannot INSERT a brand-new owner membership directly (table call).
select pg_temp.expect_fail($$
  insert into public.org_members (org_id, user_id, role, member_type, status)
  values ('aaaa1111-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777','owner','owner','active')
$$, 'T16: admin cannot INSERT a new owner membership directly');

-- TEST 17: admin cannot forge org_id to invite into an org they do not administer.
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('bbbb1111-0000-0000-0000-000000000000','cross@p0.dev','admin','admin','tok-x-1','pending')
$$, 'T17: admin cannot create invitation in another org (org_id forge)');

-- TEST 18: spoofing invited_by does not enable an owner invitation.
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, invited_by, status)
  values ('aaaa1111-0000-0000-0000-000000000000','evil3@p0.dev','owner','owner','tok-ev-3',
          '11111111-1111-1111-1111-111111111111','pending')
$$, 'T18: spoofed invited_by cannot create owner invitation');

-- TEST 13: a non-owner (admin) cannot call grant_owner().
select pg_temp.expect_fail($$
  select public.grant_owner('aaaa1111-0000-0000-0000-000000000000',
                            '44444444-4444-4444-4444-444444444444')
$$, 'T13: admin cannot call grant_owner()');

reset role;
reset request.jwt.claims;

-- ── TEST 7–10: member / contractor / client / viewer cannot invite an owner ──
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','e7@p0.dev','owner','owner','tok-7','pending')
$$, 'T7: member cannot create owner invitation');

set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','e8@p0.dev','owner','owner','tok-8','pending')
$$, 'T8: contractor cannot create owner invitation');

set request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','e9@p0.dev','owner','owner','tok-9','pending')
$$, 'T9: client cannot create owner invitation');

set request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','e10@p0.dev','owner','owner','tok-10','pending')
$$, 'T10: viewer cannot create owner invitation');

reset role;
reset request.jwt.claims;

-- ── TEST 11: unauthenticated (anon) cannot invite an owner ───────────────────
set role anon;
set request.jwt.claims = '{"role":"anon"}';
select pg_temp.expect_fail($$
  insert into public.org_invitations (org_id, email, role, member_type, token, status)
  values ('aaaa1111-0000-0000-0000-000000000000','e11@p0.dev','owner','owner','tok-11','pending')
$$, 'T11: anon cannot create owner invitation');
reset role;
reset request.jwt.claims;

-- ── TEST 4: even a smuggled owner invitation cannot be accepted ──────────────
-- Inject one as superuser with the CHECKs temporarily removed (simulates a row
-- predating the constraint), then prove acceptance is still refused.
alter table public.org_invitations drop constraint org_invitations_no_owner_role;
alter table public.org_invitations drop constraint org_invitations_no_owner_type;
insert into public.org_invitations (org_id, email, role, member_type, token, status)
values ('aaaa1111-0000-0000-0000-000000000000','admin-a@p0.dev','owner','owner','tok-evil','pending');

set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  select public.accept_org_invitation('tok-evil')
$$, 'T4: admin cannot accept a smuggled owner invitation');
-- And the membership must NOT have become owner.
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  (select role from public.org_members
     where org_id='aaaa1111-0000-0000-0000-000000000000'
       and user_id='22222222-2222-2222-2222-222222222222') = 'admin',
  'T4b: admin membership remains admin after blocked acceptance');

-- ── TEST 12/14/15: legitimate owner grant works, is correct, and is audited ──
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_ok($$
  select public.grant_owner('aaaa1111-0000-0000-0000-000000000000',
                            '44444444-4444-4444-4444-444444444444')
$$, 'T12: existing owner can grant owner');
reset role;
reset request.jwt.claims;

select pg_temp.ok(
  (select role from public.org_members
     where org_id='aaaa1111-0000-0000-0000-000000000000'
       and user_id='44444444-4444-4444-4444-444444444444') = 'owner'
  and (select member_type from public.org_members
     where org_id='aaaa1111-0000-0000-0000-000000000000'
       and user_id='44444444-4444-4444-4444-444444444444') = 'owner',
  'T14: grant_owner sets role AND member_type to owner');

select pg_temp.ok(
  exists (select 1 from public.audit_logs
    where org_id='aaaa1111-0000-0000-0000-000000000000'
      and action='member.owner_granted'
      and entity_type='org_member'
      and actor_id='11111111-1111-1111-1111-111111111111'),
  'T15: owner grant writes an audit event');

-- ═════════════════════════════════════════════════════════════════════════════
-- PHASE 0B — TENANT KEY (org_id) IMMUTABILITY
-- ═════════════════════════════════════════════════════════════════════════════

-- B6 (owner): a legitimately-authorized owner cannot move a row to another org.
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  update public.projects set org_id='bbbb1111-0000-0000-0000-000000000000'
   where id='aaaa2222-0000-0000-0000-000000000000'
$$, 'B-owner: owner cannot change org_id to another valid org');

-- B (owner): to a nonexistent org still fails (trigger fires before FK check).
select pg_temp.expect_fail($$
  update public.projects set org_id='00000000-0000-0000-0000-0000000000ff'
   where id='aaaa2222-0000-0000-0000-000000000000'
$$, 'B-owner: owner cannot change org_id to a nonexistent org');

-- B (owner): unrelated column remains updatable.
select pg_temp.expect_ok($$
  update public.projects set name='Project A (renamed)'
   where id='aaaa2222-0000-0000-0000-000000000000'
$$, 'B: non-tenant-key column is still updatable');

-- B: legitimate INSERT with a valid org_id still works.
select pg_temp.expect_ok($$
  insert into public.projects (id, org_id, name)
  values ('aaaa2223-0000-0000-0000-000000000000','aaaa1111-0000-0000-0000-000000000000','Project A2')
$$, 'B: INSERT with valid org_id still works');
reset role;
reset request.jwt.claims;

-- B-admin: administrator cannot change org_id.
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}';
select pg_temp.expect_fail($$
  update public.projects set org_id='bbbb1111-0000-0000-0000-000000000000'
   where id='aaaa2222-0000-0000-0000-000000000000'
$$, 'B-admin: admin cannot change org_id');
reset role;
reset request.jwt.claims;

-- B-member / B-contractor: invariant holds (RLS or trigger) — org_id unchanged.
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal1"}';
update public.projects set org_id='bbbb1111-0000-0000-0000-000000000000'
  where id='aaaa2222-0000-0000-0000-000000000000';  -- RLS: no-op for non-manager
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}';
update public.projects set org_id='bbbb1111-0000-0000-0000-000000000000'
  where id='aaaa2222-0000-0000-0000-000000000000';  -- RLS: no-op for contractor
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  (select org_id from public.projects where id='aaaa2222-0000-0000-0000-000000000000')
    = 'aaaa1111-0000-0000-0000-000000000000',
  'B-member/contractor: org_id unchanged after their attempts');

-- B-direct-SQL: even superuser / service role (RLS-bypassing) cannot change org_id.
select pg_temp.expect_fail($$
  update public.projects set org_id='bbbb1111-0000-0000-0000-000000000000'
   where id='aaaa2222-0000-0000-0000-000000000000'
$$, 'B-direct: superuser/service role cannot change org_id (trigger blocks)');

-- B-retain: the original row still carries its original org_id.
select pg_temp.ok(
  (select org_id from public.projects where id='aaaa2222-0000-0000-0000-000000000000')
    = 'aaaa1111-0000-0000-0000-000000000000',
  'B-retain: existing row retains its org_id');

rollback;
