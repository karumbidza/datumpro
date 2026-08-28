-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — approval matrix regression (set_org_approval_matrix).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/approval_matrix.sql
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;

-- Org + an admin (owner) and a non-admin member.
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'am-owner@test.dev'),
  ('d0000000-0000-0000-0000-000000000002', 'am-member@test.dev');
insert into public.organizations (id, name) values ('d1110000-0000-0000-0000-000000000000', 'AM Org');
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('d1110000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', 'owner', 'owner', 'active'),
  ('d1110000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000002', 'member', 'staff', 'active');

-- Configure: payment needs PM → Finance → Admin above $5,000; everything else PM-only.
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select public.set_org_approval_matrix(
  'd1110000-0000-0000-0000-000000000000',
  '[{"entity_type":"payment","extra_roles":["finance","admin"],"min_amount_cents":500000}]'::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.ok(
  (select count(*) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment') = 3,
  '1: payment has 3 steps (PM + finance + admin)');
select pg_temp.ok(
  (select approver_role::text from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order=1) = 'pm',
  '2: payment step 1 is PM at threshold 0');
select pg_temp.ok(
  (select array_agg(approver_role::text order by step_order) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order>=2)
    = array['finance','admin'],
  '3: payment steps 2..3 are finance then admin');
select pg_temp.ok(
  (select bool_and(min_amount_cents=500000) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order>=2),
  '4: payment extra steps carry the $5,000 threshold');
select pg_temp.ok(
  (select count(*) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='task_plan') = 1,
  '5: an unconfigured entity type keeps PM-only (step 1)');

-- seed_approval_steps materialises the configured chain for an above-threshold entity.
select pg_temp.ok(
  (select count(*) from (
     select public.seed_approval_steps('payment', 'd2220000-0000-0000-0000-000000000000',
       'd1110000-0000-0000-0000-000000000000', 600000)) s
     ) >= 0,  -- call succeeds
  '6: seed_approval_steps runs for a payment');
select pg_temp.ok(
  (select count(*) from public.approvals
     where org_id='d1110000-0000-0000-0000-000000000000'
       and entity_type='payment' and entity_id='d2220000-0000-0000-0000-000000000000') = 3,
  '7: a $6,000 payment seeds the full 3-step chain');

-- A non-admin cannot change the matrix.
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.set_org_approval_matrix('d1110000-0000-0000-0000-000000000000', '[]'::jsonb);
  raise exception 'FAIL: 8: a non-admin changed the approval matrix';
exception when others then
  if position('owner or admin' in SQLERRM) > 0 then raise notice 'PASS: 8: non-admin rejected.';
  else raise; end if;
end $$;
reset role; reset request.jwt.claims;

rollback;

\echo '────────────────────────────────────────────'
\echo 'All approval-matrix checks passed.'
\echo '────────────────────────────────────────────'
