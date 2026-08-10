-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — RLS / tenancy regression tests (security assessment F9)
--
-- Runnable defence-in-depth check for the invariants the security assessment
-- relied on. Run against a database that has all migrations applied:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_security.sql
--
-- Every assertion prints `PASS: …`; the first failure raises and (with
-- ON_ERROR_STOP=1) exits non-zero, so this is CI-gateable. The whole run is one
-- transaction that ROLLBACKs — it leaves no data behind.
--
-- Covers:
--   • Tenant isolation — a member of org A cannot read org B's rows.
--   • F2 — org-required MFA is enforced at the data layer (AAL1 blocked,
--     AAL2 allowed) and non-MFA orgs are unaffected at AAL1.
--   • F5 — org_domains_update carries a WITH CHECK.
--   • F7 — per-user organisation-creation cap.
--   • Static posture — no `USING (true)` policy, no SECURITY DEFINER function in
--     public without a pinned search_path, no anon table privileges on core
--     tenant tables, RLS enabled on core tenant tables.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
begin;

-- Assertion helper (session-temp; PUBLIC execute so role-switched code can call).
create or replace function pg_temp.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS: %', label;
  else raise exception 'FAIL: %', label;
  end if;
end $$;

-- ── Seed (as superuser, RLS bypassed) ────────────────────────────────────────
-- Org A and Org B: two separate tenants (no MFA). Org M: requires MFA.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','user-a@test.dev'),
  ('b0000000-0000-0000-0000-0000000000b1','user-b@test.dev'),
  ('c0000000-0000-0000-0000-0000000000c1','user-m@test.dev');

insert into public.organizations (id, name, require_mfa) values
  ('a1110000-0000-0000-0000-000000000000','Org A', false),
  ('b1110000-0000-0000-0000-000000000000','Org B', false),
  ('c1110000-0000-0000-0000-000000000000','Org M', true);

insert into public.org_members (org_id, user_id, role, status) values
  ('a1110000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a1','owner','active'),
  ('b1110000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-0000000000b1','owner','active'),
  ('c1110000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-0000000000c1','owner','active');

insert into public.projects (id, org_id, name) values
  ('a2220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','Project A'),
  ('b2220000-0000-0000-0000-000000000000','b1110000-0000-0000-0000-000000000000','Project B');

-- BOQ estimate library (org-scoped): one bill per tenant, with a section + a
-- priced item in org A to exercise the composite FK and the generated total.
insert into public.boqs (id, org_id, name) values
  ('a3330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','BOQ A'),
  ('b3330000-0000-0000-0000-000000000000','b1110000-0000-0000-0000-000000000000','BOQ B');
insert into public.boq_sections (id, org_id, boq_id, name) values
  ('a3340000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','Substructure');
insert into public.boq_items (id, org_id, section_id, description, uom, qty, budget_rate_cents) values
  ('a3350000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3340000-0000-0000-0000-000000000000','Excavate to reduced level','m³',10,250);

-- Contractor in org A + two tenders on BOQ A: one the contractor is invited to bid
-- on, one they are not. Exercises the Piece 2 role split — a contractor is an org
-- member but must NOT read the BOQ library / PRIVATE budget rates, only tenders they
-- were invited to (via is_tender_bidder), still able to price through the
-- tender_bill_lines projection (which omits budget_rate_cents).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a2','contractor-a@test.dev');
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('a1110000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a2','member','contractor','active');
insert into public.boq_tenders (id, org_id, boq_id, title, status) values
  ('a3360000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','Tender A1','open'),
  ('a3380000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','Tender A2 (contractor not invited)','open');
insert into public.boq_bidders (id, org_id, tender_id, company_name, contact_email, invite_token, user_id, status) values
  ('a3370000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3360000-0000-0000-0000-000000000000','Contractor A Ltd','contractor-a@test.dev','tok-a337','a0000000-0000-0000-0000-0000000000a2','invited');

-- Piece 3 (award→delivery bridge): a separate AWARDED tender on BOQ A, won by
-- contractor a2, with one priced line — exercises export_award_to_project.
insert into public.boq_tenders (id, org_id, boq_id, title, status, unsealed_at, awarded_bidder_id) values
  ('a3390000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','Awarded Tender','awarded', now(), 'a33a0000-0000-0000-0000-000000000000');
insert into public.boq_bidders (id, org_id, tender_id, company_name, contact_email, invite_token, user_id, status, submitted_at) values
  ('a33a0000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3390000-0000-0000-0000-000000000000','Winner A Ltd','contractor-a@test.dev','tok-a33a','a0000000-0000-0000-0000-0000000000a2','submitted', now());
insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid) values
  ('a1110000-0000-0000-0000-000000000000','a33a0000-0000-0000-0000-000000000000','a3350000-0000-0000-0000-000000000000',300,false);

-- ── Tenant isolation: user A sees only org A ─────────────────────────────────
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok((select count(*) from public.organizations where id = 'a1110000-0000-0000-0000-000000000000') = 1,
  'tenant: user A can read own org');
select pg_temp.ok((select count(*) from public.organizations where id = 'b1110000-0000-0000-0000-000000000000') = 0,
  'tenant: user A CANNOT read org B');
select pg_temp.ok((select count(*) from public.projects where id = 'a2220000-0000-0000-0000-000000000000') = 1,
  'tenant: user A can read own project');
select pg_temp.ok((select count(*) from public.projects where id = 'b2220000-0000-0000-0000-000000000000') = 0,
  'tenant: user A CANNOT read org B project');

-- BOQ estimate library is org-isolated exactly like projects.
select pg_temp.ok((select count(*) from public.boqs where id = 'a3330000-0000-0000-0000-000000000000') = 1,
  'tenant: user A can read own BOQ');
select pg_temp.ok((select count(*) from public.boqs where id = 'b3330000-0000-0000-0000-000000000000') = 0,
  'tenant: user A CANNOT read org B BOQ');
select pg_temp.ok((select count(*) from public.boq_sections where boq_id = 'a3330000-0000-0000-0000-000000000000') = 1,
  'tenant: user A can read own BOQ section');
select pg_temp.ok((select count(*) from public.boq_items where id = 'a3350000-0000-0000-0000-000000000000') = 1,
  'tenant: user A can read own BOQ item');
-- Generated roll-up: amount_cents = round(qty × budget_rate_cents) = 10 × 250.
select pg_temp.ok((select amount_cents from public.boq_items where id = 'a3350000-0000-0000-0000-000000000000') = 2500,
  'boq_item.amount_cents is the generated qty × rate total');

-- A cannot write into org B (RLS WITH CHECK on insert).
do $$
begin
  insert into public.projects (org_id, name)
  values ('b1110000-0000-0000-0000-000000000000','Injected');
  raise exception 'FAIL: user A inserted a project into org B';
exception
  when insufficient_privilege or check_violation then
    raise notice 'PASS: tenant: user A CANNOT insert into org B (%).', sqlstate;
end $$;

reset role;
reset request.jwt.claims;

-- ── F2: MFA enforced at the data layer ───────────────────────────────────────
set role authenticated;

-- AAL1 in a require_mfa org: no visibility, and the UX gate flags it.
set request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.organizations where id = 'c1110000-0000-0000-0000-000000000000') = 0,
  'F2: AAL1 session cannot read a require_mfa org');
select pg_temp.ok(public.mfa_required_pending() = true,
  'F2: AAL1 session in require_mfa org reports mfa_required_pending');

-- AAL2 in the same org: full visibility, gate clear.
set request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated","aal":"aal2"}';
select pg_temp.ok((select count(*) from public.organizations where id = 'c1110000-0000-0000-0000-000000000000') = 1,
  'F2: AAL2 session can read the require_mfa org');
select pg_temp.ok(public.mfa_required_pending() = false,
  'F2: AAL2 session clears mfa_required_pending');

-- Non-MFA org is unaffected by AAL1 (the common password-only session).
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.organizations where id = 'a1110000-0000-0000-0000-000000000000') = 1,
  'F2: AAL1 session works normally in a non-MFA org (no regression)');
select pg_temp.ok(public.mfa_required_pending() = false,
  'F2: non-MFA member never sees a pending-MFA gate');

reset role;
reset request.jwt.claims;

-- ── F5: org_domains_update has a WITH CHECK ──────────────────────────────────
select pg_temp.ok(
  exists (select 1 from pg_policy where polname = 'org_domains_update' and polwithcheck is not null),
  'F5: org_domains_update policy carries a WITH CHECK');

-- ── F7: organisation-creation cap ────────────────────────────────────────────
insert into auth.users (id, email) values ('d0000000-0000-0000-0000-0000000000d1','capper@test.dev');
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal1"}';
do $$
declare i int;
begin
  for i in 1..10 loop perform public.create_organization('Cap Org '||i); end loop;
end $$;
select pg_temp.ok(
  (select count(*) from public.org_members
    where user_id = 'd0000000-0000-0000-0000-0000000000d1' and role = 'owner' and status = 'active') = 10,
  'F7: user can create up to the cap (10) organisations');
do $$
begin
  perform public.create_organization('Cap Org 11');
  raise exception 'FAIL: 11th organisation was created past the cap';
exception
  when check_violation then
    raise notice 'PASS: F7: 11th organisation is rejected by the cap.';
end $$;
reset role;
reset request.jwt.claims;

-- ── Piece 2: BOQ role split — staff read the library, contractors do not ──────
-- is_org_staff() keys on member_type (staff vs contractor both hold org_role
-- 'member'). Staff read the whole BOQ library incl. PRIVATE budget rates and every
-- org tender; a contractor org-member is blocked from the library and sees only
-- tenders they were invited to bid on, still able to price via tender_bill_lines
-- (which never returns budget_rate_cents).
set role authenticated;

-- Staff (user A, member_type defaults to 'staff'): full library + both tenders.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.boq_items where id = 'a3350000-0000-0000-0000-000000000000') = 1,
  'role-split: staff can read BOQ library items');
select pg_temp.ok((select count(*) from public.boq_tenders where org_id = 'a1110000-0000-0000-0000-000000000000') = 2,
  'role-split: staff can read all org tenders');

-- Contractor (user A2, member_type contractor): no library, only their tender.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.boqs where id = 'a3330000-0000-0000-0000-000000000000') = 0,
  'role-split: contractor CANNOT read the BOQ library (bill header)');
select pg_temp.ok((select count(*) from public.boq_items where id = 'a3350000-0000-0000-0000-000000000000') = 0,
  'role-split: contractor CANNOT read boq_items / budget rates');
select pg_temp.ok((select count(*) from public.boq_tenders where org_id = 'a1110000-0000-0000-0000-000000000000') = 1,
  'role-split: contractor sees ONLY tenders they were invited to');
select pg_temp.ok((select count(*) from public.boq_tenders where id = 'a3360000-0000-0000-0000-000000000000') = 1,
  'role-split: contractor can see their own tender');
select pg_temp.ok((select count(*) from public.boq_tenders where id = 'a3380000-0000-0000-0000-000000000000') = 0,
  'role-split: contractor CANNOT see a tender they were not invited to');
select pg_temp.ok((select count(*) from public.tender_bill_lines('a3360000-0000-0000-0000-000000000000')) = 1,
  'role-split: contractor can still price via tender_bill_lines (budget rate omitted)');

reset role;
reset request.jwt.claims;

-- ── Piece 3: award→delivery bridge — auth guard + idempotency ─────────────────
-- export_award_to_project() converts an awarded tender into a project + costed
-- tasks assigned to the winner. Guard must reject non-staff (the guard coalesces
-- is_org_admin()/org_role(), both NULL for a non-member); export is idempotent.
set role authenticated;

-- Outsider (user B, not a member of org A) cannot export org A's awarded tender.
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Hack');
  raise exception 'FAIL: bridge: an outsider exported an awarded tender';
exception when others then
  if position('not authorised' in SQLERRM) > 0 then raise notice 'PASS: bridge: outsider blocked from export.';
  else raise; end if;
end $$;

-- Staff (user A, owner) exports → project created, winner enrolled as contractor.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v_proj uuid;
begin
  select public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Delivery A') into v_proj;
  perform pg_temp.ok(v_proj is not null, 'bridge: staff export returns a project id');
  perform pg_temp.ok(
    (select awarded_project_id from public.boq_tenders where id = 'a3390000-0000-0000-0000-000000000000') = v_proj,
    'bridge: tender linked to the delivery project');
  perform pg_temp.ok(
    exists (select 1 from public.project_members
            where project_id = v_proj and user_id = 'a0000000-0000-0000-0000-0000000000a2' and role = 'contractor'),
    'bridge: winner enrolled as project contractor');
end $$;

-- Second export is blocked (idempotent).
do $$
begin
  perform public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Again');
  raise exception 'FAIL: bridge: second export was not blocked';
exception when others then
  if position('already exported' in SQLERRM) > 0 then raise notice 'PASS: bridge: second export blocked (idempotent).';
  else raise; end if;
end $$;

reset role;
reset request.jwt.claims;

-- ── Static posture checks (catalog-level, superuser) ─────────────────────────

-- No policy grants blanket read via USING (true) in the public schema.
select pg_temp.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and coalesce(btrim(lower(qual)), '') = 'true'
  ),
  'static: no USING (true) policy in public schema');

-- Every SECURITY DEFINER function in public pins its search_path (search_path
-- injection guard). Fails loudly if a future migration forgets `set search_path`.
select pg_temp.ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ),
  'static: all SECURITY DEFINER functions in public pin search_path');

-- Core tenant tables have RLS enabled.
select pg_temp.ok(
  (select bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('organizations','org_members','projects','tasks','invitations')),
  'static: RLS enabled on core tenant tables');

-- anon has no POLICY on core tenant tables. In the Supabase model anon holds the
-- default table GRANTs, so what actually protects the data is the absence of any
-- anon-facing policy — RLS then denies every row. (Public writes go only through
-- SECURITY DEFINER RPCs, which bypass RLS as the function owner.)
select pg_temp.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and 'anon' = any (roles)
      and tablename in ('organizations','org_members','projects','tasks','enterprise_requests')
  ),
  'static: no anon-facing policy on core tenant tables');

-- Effective check: with those grants but no policy, anon reads zero rows.
set role anon;
set request.jwt.claims = '{"role":"anon"}';
select pg_temp.ok((select count(*) from public.organizations) = 0,
  'static: anon effectively reads zero rows from organizations (RLS denies)');
reset role;
reset request.jwt.claims;

-- ── BOQ Sealed-Tender invariants ─────────────────────────────────────────────
--
-- Fixtures: reuse org A (a111…), the existing BOQ A (a333…), section (a334…),
-- and item (a335…). Add two bidder auth users: bidder-x (admin/staff for org A,
-- used as the "org admin" perspective) and bidder-y (external bidder).
-- User A (a000…a1) is already an owner of org A so doubles as the admin viewer.

-- Two external bidder users (not org members).
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000e1','bidder-x@test.dev'),
  ('f0000000-0000-0000-0000-0000000000f1','bidder-y@test.dev');

-- Tender on Org A's BOQ (inserted as superuser — RLS bypassed).
insert into public.boq_tenders (id, org_id, boq_id, title, status, unsealed_at, created_by) values
  ('t0000000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000',
   'a3330000-0000-0000-0000-000000000000',
   'Tender T1', 'open', null,
   'a0000000-0000-0000-0000-0000000000a1');

-- Two bidders linked to the tender.
insert into public.boq_bidders
  (id, org_id, tender_id, company_name, contact_email, user_id, invite_token, status) values
  ('bd000000-0000-0000-0000-0000000000b1',
   'a1110000-0000-0000-0000-000000000000',
   't0000000-0000-0000-0000-000000000001',
   'Bidder X Ltd','bidder-x@test.dev',
   'e0000000-0000-0000-0000-0000000000e1',
   'token-x-00000000000000000000000000000001',
   'submitted'),
  ('bd000000-0000-0000-0000-0000000000b2',
   'a1110000-0000-0000-0000-000000000000',
   't0000000-0000-0000-0000-000000000001',
   'Bidder Y Ltd','bidder-y@test.dev',
   'f0000000-0000-0000-0000-0000000000f1',
   'token-y-00000000000000000000000000000002',
   'viewing');

-- One bid item per bidder for the existing boq_item (a335…).
insert into public.boq_bid_items (id, org_id, bidder_id, boq_item_id, rate_cents) values
  ('bi000000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000',
   'bd000000-0000-0000-0000-0000000000b1',
   'a3350000-0000-0000-0000-000000000000',
   300),
  ('bi000000-0000-0000-0000-000000000002',
   'a1110000-0000-0000-0000-000000000000',
   'bd000000-0000-0000-0000-0000000000b2',
   'a3350000-0000-0000-0000-000000000000',
   320);

-- ── Invariant 1: Seal gate (org admin perspective) ────────────────────────────
-- unsealed_at IS NULL → staff read returns 0 rows.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok(
  (select count(*) from public.boq_bid_items
     where bidder_id in (
       'bd000000-0000-0000-0000-0000000000b1',
       'bd000000-0000-0000-0000-0000000000b2'
     )) = 0,
  'tender-seal: org admin sees 0 bid items while tender is sealed (unsealed_at NULL)');

reset role;
reset request.jwt.claims;

-- Unseal the tender (as superuser).
update public.boq_tenders
   set unsealed_at = now()
 where id = 't0000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok(
  (select count(*) from public.boq_bid_items
     where bidder_id in (
       'bd000000-0000-0000-0000-0000000000b1',
       'bd000000-0000-0000-0000-0000000000b2'
     )) > 0,
  'tender-seal: org admin sees bid items after tender is unsealed');

reset role;
reset request.jwt.claims;

-- Re-seal for remaining tests.
update public.boq_tenders set unsealed_at = null where id = 't0000000-0000-0000-0000-000000000001';

-- ── Invariant 2: Bidder isolation + no budget_rate_cents ──────────────────────
-- Bidder Y (status 'viewing') can call tender_bill_lines and sees lines (>0).
-- Bidder Y can only read its own boq_bid_items, not bidder X's.
-- tender_bill_lines return type has no budget_rate_cents column.
set role authenticated;
set request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok(
  (select count(*) from public.tender_bill_lines('t0000000-0000-0000-0000-000000000001')) > 0,
  'tender-bidder: bidder Y sees bill lines via tender_bill_lines');

select pg_temp.ok(
  (select count(*) from public.boq_bid_items
     where bidder_id = 'bd000000-0000-0000-0000-0000000000b2') = 1,
  'tender-bidder: bidder Y sees only its own bid item');

select pg_temp.ok(
  (select count(*) from public.boq_bid_items
     where bidder_id = 'bd000000-0000-0000-0000-0000000000b1') = 0,
  'tender-bidder: bidder Y CANNOT see bidder X''s bid items');

reset role;
reset request.jwt.claims;

-- tender_bill_lines return type must NOT contain budget_rate_cents (static catalog check).
-- pg_proc.proargnames lists OUT-param names for TABLE-returning functions.
select pg_temp.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'tender_bill_lines'
      and 'budget_rate_cents' = any(p.proargnames)
  ),
  'tender-bidder: tender_bill_lines return type has no budget_rate_cents column');

-- ── Invariant 3: Tenant isolation (org B member sees nothing) ─────────────────
-- User B is a member of org B only; they must see 0 rows for org A's tender.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok(
  (select count(*) from public.boq_tenders
     where id = 't0000000-0000-0000-0000-000000000001') = 0,
  'tender-tenant: org B user sees 0 rows in boq_tenders for org A tender');

select pg_temp.ok(
  (select count(*) from public.boq_bidders
     where tender_id = 't0000000-0000-0000-0000-000000000001') = 0,
  'tender-tenant: org B user sees 0 rows in boq_bidders for org A tender');

select pg_temp.ok(
  (select count(*) from public.boq_bid_items
     where org_id = 'a1110000-0000-0000-0000-000000000000') = 0,
  'tender-tenant: org B user sees 0 rows in boq_bid_items for org A');

reset role;
reset request.jwt.claims;

-- ── Invariant 4: Submit lock (submitted bidder cannot mutate bid items) ────────
-- Bidder X has status 'submitted'. The boq_bid_items_bidder_rw policy only allows
-- status in ('invited','viewing'), so insert/update by bidder X must be rejected.
set role authenticated;
set request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000e1","role":"authenticated","aal":"aal1"}';

do $$
begin
  insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents)
  values (
    'a1110000-0000-0000-0000-000000000000',
    'bd000000-0000-0000-0000-0000000000b1',
    'a3350000-0000-0000-0000-000000000000',
    999
  );
  raise exception 'FAIL: submitted bidder inserted a new bid item (RLS should block)';
exception
  when insufficient_privilege or check_violation or unique_violation then
    raise notice 'PASS: tender-submit-lock: insert by submitted bidder rejected (%).',sqlstate;
end $$;

do $$
begin
  update public.boq_bid_items
     set rate_cents = 1
   where bidder_id = 'bd000000-0000-0000-0000-0000000000b1';
  -- RLS silently returns 0 rows affected on UPDATE; confirm nothing changed.
  if exists (select 1 from public.boq_bid_items
               where bidder_id = 'bd000000-0000-0000-0000-0000000000b1'
                 and rate_cents = 1) then
    raise exception 'FAIL: submitted bidder updated a bid item rate (RLS should block)';
  else
    raise notice 'PASS: tender-submit-lock: update by submitted bidder returned 0 rows affected.';
  end if;
end $$;

reset role;
reset request.jwt.claims;

-- ── Phase 2: unseal gate + award_boq_tender assertions ──────────────────────
--
-- We need independent state control for each sub-scenario, so we introduce
-- fresh tenders with UUID prefix c2a… and fresh bidders with prefix c2b….
-- The admin identity is user A (a000…a1), owner of org A.
-- All fixtures are inserted as superuser (RLS bypassed).
--
-- Sub-scenarios:
--   P2-A  Gate blocks early: ≥1 submitted but NOT (all submitted OR past deadline)
--   P2-B  Gate passes: all non-withdrawn bidders submitted
--   P2-C  Gate passes: past deadline (close_at < now())
--   P2-D  award_boq_tender: requires unseal; valid/invalid bidder paths

-- ── P2 shared bidder users (reuse e0…e1 and f0…f1 defined in Phase 1) ────────
-- (No new auth.users needed — bidder X and Y auth users already exist.)

-- ── P2-A fixture: tender with future deadline, one submitted, one viewing ─────
insert into public.boq_tenders
  (id, org_id, boq_id, title, status, close_at, unsealed_at, created_by) values
  ('c2a00000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000',
   'a3330000-0000-0000-0000-000000000000',
   'Tender P2-A', 'open',
   now() + interval '30 days',   -- future deadline → deadline path not yet open
   null,
   'a0000000-0000-0000-0000-0000000000a1');

insert into public.boq_bidders
  (id, org_id, tender_id, company_name, contact_email, user_id, invite_token, status) values
  ('c2b00000-0000-0000-0000-0000000000a1',
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000001',
   'P2-A Bidder 1','p2a-b1@test.dev',
   'e0000000-0000-0000-0000-0000000000e1',
   'token-p2a-b1-0000000000000000000000000001',
   'submitted'),
  ('c2b00000-0000-0000-0000-0000000000a2',
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000001',
   'P2-A Bidder 2','p2a-b2@test.dev',
   'f0000000-0000-0000-0000-0000000000f1',
   'token-p2a-b2-0000000000000000000000000002',
   'viewing');        -- NOT submitted → gate should block

-- P2-A assertions (superuser role — RPCs are SECURITY DEFINER and check auth
-- internally; calling as superuser exercises the eligibility logic directly).
reset role;
reset request.jwt.claims;

select pg_temp.ok(
  public.tender_unseal_eligible('c2a00000-0000-0000-0000-000000000001') = false,
  'P2-A: tender_unseal_eligible FALSE when one bidder is still viewing (future deadline)');

-- unseal_tender must raise when not eligible.
do $$
begin
  perform public.unseal_tender('c2a00000-0000-0000-0000-000000000001');
  raise exception 'FAIL: P2-A: unseal_tender did not raise on ineligible tender';
exception
  when sqlstate 'P0001' or insufficient_privilege or check_violation then
    raise notice 'PASS: P2-A: unseal_tender raised on ineligible tender (%).',sqlstate;
end $$;

-- Confirm tender remains unsealed.
select pg_temp.ok(
  (select unsealed_at from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000001') is null,
  'P2-A: unsealed_at remains NULL after rejected unseal attempt');

-- ── P2-B fixture: same tender, promote both bidders to submitted ───────────────
update public.boq_bidders
   set status = 'submitted'
 where tender_id = 'c2a00000-0000-0000-0000-000000000001';

select pg_temp.ok(
  public.tender_unseal_eligible('c2a00000-0000-0000-0000-000000000001') = true,
  'P2-B: tender_unseal_eligible TRUE when all bidders submitted');

-- unseal_tender returns a non-null timestamp.
do $$
declare
  ts1 timestamptz;
  ts2 timestamptz;
begin
  ts1 := public.unseal_tender('c2a00000-0000-0000-0000-000000000001');
  perform pg_temp.ok(ts1 is not null, 'P2-B: unseal_tender returns non-null timestamp');

  -- Idempotent: second call returns the SAME timestamp, no error.
  ts2 := public.unseal_tender('c2a00000-0000-0000-0000-000000000001');
  perform pg_temp.ok(ts2 = ts1, 'P2-B: unseal_tender is idempotent (same timestamp on second call)');
end $$;

-- Confirm DB row reflects unsealed_at.
select pg_temp.ok(
  (select unsealed_at from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000001') is not null,
  'P2-B: boq_tenders.unsealed_at is set after successful unseal');

-- ── P2-C fixture: new tender with PAST deadline, one submitted, one viewing ────
insert into public.boq_tenders
  (id, org_id, boq_id, title, status, close_at, unsealed_at, created_by) values
  ('c2a00000-0000-0000-0000-000000000002',
   'a1110000-0000-0000-0000-000000000000',
   'a3330000-0000-0000-0000-000000000000',
   'Tender P2-C', 'open',
   now() - interval '1 day',    -- past deadline → deadline path open
   null,
   'a0000000-0000-0000-0000-0000000000a1');

insert into public.boq_bidders
  (id, org_id, tender_id, company_name, contact_email, user_id, invite_token, status) values
  ('c2b00000-0000-0000-0000-0000000000c1',
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000002',
   'P2-C Bidder 1','p2c-b1@test.dev',
   'e0000000-0000-0000-0000-0000000000e1',
   'token-p2c-b1-0000000000000000000000000003',
   'submitted'),
  ('c2b00000-0000-0000-0000-0000000000c2',
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000002',
   'P2-C Bidder 2','p2c-b2@test.dev',
   'f0000000-0000-0000-0000-0000000000f1',
   'token-p2c-b2-0000000000000000000000000004',
   'viewing');     -- not submitted, but deadline has passed

select pg_temp.ok(
  public.tender_unseal_eligible('c2a00000-0000-0000-0000-000000000002') = true,
  'P2-C: tender_unseal_eligible TRUE when close_at is in the past (deadline path)');

-- ── P2-D fixture: dedicated tender for award assertions ────────────────────────
-- Start sealed, with one submitted bidder and one viewing bidder.
insert into public.boq_tenders
  (id, org_id, boq_id, title, status, close_at, unsealed_at, created_by) values
  ('c2a00000-0000-0000-0000-000000000003',
   'a1110000-0000-0000-0000-000000000000',
   'a3330000-0000-0000-0000-000000000000',
   'Tender P2-D', 'open',
   now() - interval '1 hour',   -- past deadline so we can unseal later
   null,
   'a0000000-0000-0000-0000-0000000000a1');

insert into public.boq_bidders
  (id, org_id, tender_id, company_name, contact_email, user_id, invite_token, status) values
  ('c2b00000-0000-0000-0000-0000000000d1',   -- submitted bidder (valid award target)
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000003',
   'P2-D Bidder 1','p2d-b1@test.dev',
   'e0000000-0000-0000-0000-0000000000e1',
   'token-p2d-b1-0000000000000000000000000005',
   'submitted'),
  ('c2b00000-0000-0000-0000-0000000000d2',   -- viewing bidder (invalid award target)
   'a1110000-0000-0000-0000-000000000000',
   'c2a00000-0000-0000-0000-000000000003',
   'P2-D Bidder 2','p2d-b2@test.dev',
   'f0000000-0000-0000-0000-0000000000f1',
   'token-p2d-b2-0000000000000000000000000006',
   'viewing');

-- P2-D-1: award must raise when tender is still sealed (unsealed_at IS NULL).
do $$
begin
  perform public.award_boq_tender(
    'c2a00000-0000-0000-0000-000000000003',
    'c2b00000-0000-0000-0000-0000000000d1'
  );
  raise exception 'FAIL: P2-D-1: award_boq_tender did not raise on sealed tender';
exception
  when sqlstate 'P0001' or insufficient_privilege or check_violation then
    raise notice 'PASS: P2-D-1: award_boq_tender raised on sealed tender (%).',sqlstate;
end $$;

-- Confirm tender is still sealed and no award set.
select pg_temp.ok(
  (select unsealed_at from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000003') is null,
  'P2-D-1: unsealed_at still NULL after rejected award attempt');

select pg_temp.ok(
  (select awarded_bidder_id from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000003') is null,
  'P2-D-1: awarded_bidder_id still NULL after rejected award attempt');

-- Now unseal P2-D tender (past deadline, ≥1 submitted).
do $$
declare ts timestamptz;
begin
  ts := public.unseal_tender('c2a00000-0000-0000-0000-000000000003');
  perform pg_temp.ok(ts is not null, 'P2-D: unseal_tender succeeded for P2-D tender');
end $$;

-- P2-D-2: awarding a non-submitted bidder (status 'viewing') must raise.
do $$
begin
  perform public.award_boq_tender(
    'c2a00000-0000-0000-0000-000000000003',
    'c2b00000-0000-0000-0000-0000000000d2'   -- viewing bidder
  );
  raise exception 'FAIL: P2-D-2: award_boq_tender did not raise for non-submitted bidder';
exception
  when sqlstate 'P0001' or insufficient_privilege or check_violation then
    raise notice 'PASS: P2-D-2: award_boq_tender raised for non-submitted bidder (%).',sqlstate;
end $$;

-- P2-D-3: awarding a bidder from a DIFFERENT tender must raise.
do $$
begin
  perform public.award_boq_tender(
    'c2a00000-0000-0000-0000-000000000003',
    'bd000000-0000-0000-0000-0000000000b1'   -- belongs to t0000000…0001, not P2-D
  );
  raise exception 'FAIL: P2-D-3: award_boq_tender did not raise for foreign bidder';
exception
  when sqlstate 'P0001' or insufficient_privilege or check_violation then
    raise notice 'PASS: P2-D-3: award_boq_tender raised for bidder from wrong tender (%).',sqlstate;
end $$;

-- P2-D-4: awarding the valid submitted bidder succeeds.
do $$
begin
  perform public.award_boq_tender(
    'c2a00000-0000-0000-0000-000000000003',
    'c2b00000-0000-0000-0000-0000000000d1'
  );
end $$;

select pg_temp.ok(
  (select status from public.boq_bidders
     where id = 'c2b00000-0000-0000-0000-0000000000d1') = 'awarded',
  'P2-D-4: winning bidder status set to ''awarded''');

select pg_temp.ok(
  (select awarded_bidder_id from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000003')
    = 'c2b00000-0000-0000-0000-0000000000d1',
  'P2-D-4: boq_tenders.awarded_bidder_id set to the winning bidder');

rollback;

\echo '────────────────────────────────────────────'
\echo 'All RLS security regression checks passed.'
\echo '────────────────────────────────────────────'
