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

-- Platform baseline: hosted Supabase grants anon/authenticated/service_role the
-- default table GRANTs via ALTER DEFAULT PRIVILEGES, and RLS (per-role policies,
-- or their absence for anon) is what actually gates access. A bare local/CI
-- stack that only replays these migrations doesn't apply those platform default
-- privileges, so table access would be denied before RLS is ever reached.
-- Establish the same baseline here so the suite exercises RLS, not raw grants —
-- this mirrors production and matches the anon-holds-grants model asserted below.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

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
-- NB: the AWARDED tender (a339) for the Piece 3 award-bridge tests is seeded
-- later — after the role-split assertions — so it doesn't skew their tender
-- counts (which are written for org A's two original open tenders).

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

-- ── F7: one organisation per owner (creation cap = 1) ────────────────────────
insert into auth.users (id, email) values ('d0000000-0000-0000-0000-0000000000d1','capper@test.dev');
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.create_organization('Cap Org 1');
end $$;
select pg_temp.ok(
  (select count(*) from public.org_members
    where user_id = 'd0000000-0000-0000-0000-0000000000d1' and role = 'owner' and status = 'active') = 1,
  'F7: an account can create its one organisation');
do $$
begin
  perform public.create_organization('Cap Org 2');
  raise exception 'FAIL: a second organisation was created past the one-per-owner cap';
exception
  when check_violation then
    raise notice 'PASS: F7: a second organisation is rejected by the one-per-owner cap.';
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

-- Seed the AWARDED tender now (as superuser, RLS bypassed) — after the role-split
-- assertions so it doesn't inflate their counts. boq_tenders.awarded_bidder_id ⇄
-- boq_bidders.tender_id form a circular FK, so seed the tender with no winner,
-- add the winning bidder, then set the winner (mirrors the real award flow;
-- awarded_bidder_id is un-guarded — RPC-gated — so the update is safe).
insert into public.boq_tenders (id, org_id, boq_id, title, status, unsealed_at) values
  ('a3390000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3330000-0000-0000-0000-000000000000','Awarded Tender','awarded', now());
insert into public.boq_bidders (id, org_id, tender_id, company_name, contact_email, invite_token, user_id, status, submitted_at) values
  ('a33a0000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a3390000-0000-0000-0000-000000000000','Winner A Ltd','contractor-a@test.dev','tok-a33a','a0000000-0000-0000-0000-0000000000a2','submitted', now());
update public.boq_tenders set awarded_bidder_id = 'a33a0000-0000-0000-0000-000000000000'
  where id = 'a3390000-0000-0000-0000-000000000000';
insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid) values
  ('a1110000-0000-0000-0000-000000000000','a33a0000-0000-0000-0000-000000000000','a3350000-0000-0000-0000-000000000000',300,false);

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
  select (public.export_award_to_project('a3390000-0000-0000-0000-000000000000', null, 'Delivery A')->>'project_id')::uuid
    into v_proj;
  perform pg_temp.ok(v_proj is not null, 'bridge: staff export returns a project id');
  perform pg_temp.ok(
    (select project_id from public.boqs where id = 'a3330000-0000-0000-0000-000000000000') = v_proj,
    'bridge: standalone BOQ linked to the delivery project on export');
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

-- Hardened guard regression: the shipped tender RPCs also coalesce is_org_admin()/
-- org_role() so a non-member (user B) cannot drive them on org A's tender a336.
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.unseal_tender('a3360000-0000-0000-0000-000000000000');
  raise exception 'FAIL: guard: outsider drove unseal_tender';
exception when others then
  if position('not authorised' in SQLERRM) > 0 then raise notice 'PASS: guard: outsider blocked from unseal_tender.';
  else raise; end if;
end $$;

-- Guard helpers are NULL-safe at the source: a non-member sees is_org_admin() = false
-- (not NULL), so bare `if not is_org_admin(...)` guards (e.g. set_org_approval_policy)
-- reject them instead of letting NULL skip the raise.
select pg_temp.ok(public.is_org_admin('a1110000-0000-0000-0000-000000000000') = false,
  'guard: is_org_admin() returns false (not NULL) for a non-member');
do $$
begin
  perform public.set_org_approval_policy('a1110000-0000-0000-0000-000000000000', 'none');
  raise exception 'FAIL: guard: outsider changed org approval policy';
exception when others then
  if position('owner or admin' in SQLERRM) > 0 then raise notice 'PASS: guard: outsider blocked from set_org_approval_policy.';
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
  ('d0000000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000',
   'a3330000-0000-0000-0000-000000000000',
   'Tender T1', 'open', null,
   'a0000000-0000-0000-0000-0000000000a1');

-- Two bidders linked to the tender.
insert into public.boq_bidders
  (id, org_id, tender_id, company_name, contact_email, user_id, invite_token, status) values
  ('bd000000-0000-0000-0000-0000000000b1',
   'a1110000-0000-0000-0000-000000000000',
   'd0000000-0000-0000-0000-000000000001',
   'Bidder X Ltd','bidder-x@test.dev',
   'e0000000-0000-0000-0000-0000000000e1',
   'token-x-00000000000000000000000000000001',
   'submitted'),
  ('bd000000-0000-0000-0000-0000000000b2',
   'a1110000-0000-0000-0000-000000000000',
   'd0000000-0000-0000-0000-000000000001',
   'Bidder Y Ltd','bidder-y@test.dev',
   'f0000000-0000-0000-0000-0000000000f1',
   'token-y-00000000000000000000000000000002',
   'viewing');

-- One bid item per bidder for the existing boq_item (a335…).
insert into public.boq_bid_items (id, org_id, bidder_id, boq_item_id, rate_cents) values
  ('b1000000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000',
   'bd000000-0000-0000-0000-0000000000b1',
   'a3350000-0000-0000-0000-000000000000',
   300),
  ('b1000000-0000-0000-0000-000000000002',
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
 where id = 'd0000000-0000-0000-0000-000000000001';

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
update public.boq_tenders set unsealed_at = null where id = 'd0000000-0000-0000-0000-000000000001';

-- ── Invariant 2: Bidder isolation + no budget_rate_cents ──────────────────────
-- Bidder Y (status 'viewing') can call tender_bill_lines and sees lines (>0).
-- Bidder Y can only read its own boq_bid_items, not bidder X's.
-- tender_bill_lines return type has no budget_rate_cents column.
set role authenticated;
set request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal1"}';

select pg_temp.ok(
  (select count(*) from public.tender_bill_lines('d0000000-0000-0000-0000-000000000001')) > 0,
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
     where id = 'd0000000-0000-0000-0000-000000000001') = 0,
  'tender-tenant: org B user sees 0 rows in boq_tenders for org A tender');

select pg_temp.ok(
  (select count(*) from public.boq_bidders
     where tender_id = 'd0000000-0000-0000-0000-000000000001') = 0,
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

-- P2-A..D assertions. unseal_tender / award_boq_tender are SECURITY DEFINER but
-- were hardened (008900) to require an org admin via auth.uid() — calling as a
-- bare superuser now raises 'not authorised'. Set user A (org A owner) as the
-- caller identity; stay on the superuser role so the interleaved fixture seeding
-- still bypasses RLS (auth.uid() reads the JWT GUC regardless of session role).
reset role;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';

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

-- award marks the TENDER (status + awarded_bidder_id); the bidder row is not
-- restatused (bidder_status has no 'awarded' value), so it stays 'submitted'.
select pg_temp.ok(
  (select status from public.boq_bidders
     where id = 'c2b00000-0000-0000-0000-0000000000d1') = 'submitted',
  'P2-D-4: winning bidder row remains ''submitted'' (award marks the tender, not the bidder)');

select pg_temp.ok(
  (select awarded_bidder_id from public.boq_tenders
     where id = 'c2a00000-0000-0000-0000-000000000003')
    = 'c2b00000-0000-0000-0000-0000000000d1',
  'P2-D-4: boq_tenders.awarded_bidder_id set to the winning bidder');

-- ── Project↔BOQ: generate_tasks_from_boq — guards, numbering, budget pricing ──
-- Fixtures use the a4… range (BOQ A a333… is consumed by the Piece-3 export
-- test above). Nested section + imported item_no exercise depth-first numbering
-- and the item_no-preferred subtask titles.
reset role;
reset request.jwt.claims;
insert into public.boqs (id, org_id, name) values
  ('a4330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','BOQ Gen');
insert into public.boq_sections (id, org_id, boq_id, name, position) values
  ('a4340000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Substructure', 0);
insert into public.boq_sections (id, org_id, boq_id, name, position, parent_id) values
  ('a4341000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Groundworks', 0,
   'a4340000-0000-0000-0000-000000000000');
insert into public.boq_items (id, org_id, section_id, description, uom, qty, budget_rate_cents, item_no) values
  ('a4350000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4341000-0000-0000-0000-000000000000','Excavate','m³',10,250,'1.6'),
  ('a4351000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4341000-0000-0000-0000-000000000000','Backfill','m³',4,100,null);
insert into public.projects (id, org_id, name) values
  ('a4220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','Gen Project');

set role authenticated;
-- Outsider (org B member) blocked by the coalesced guard.
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000');
  raise exception 'FAIL: gen: outsider generated tasks';
exception when others then
  if position('not authorised' in SQLERRM) > 0 then raise notice 'PASS: gen: outsider blocked.';
  else raise; end if;
end $$;

-- Staff generates: 1 task (only the sub-section holds items), numbered depth-
-- first, unassigned, subtasks priced at budget with item_no preferred, BOQ linked.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v jsonb;
begin
  select public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000') into v;
  perform pg_temp.ok((v->>'tasks')::int = 1 and (v->>'subtasks')::int = 2, 'gen: 1 task / 2 subtasks created');
  perform pg_temp.ok((v->>'total_cents')::bigint = 2900, 'gen: total = 10×250 + 4×100');
  perform pg_temp.ok(
    exists (select 1 from public.tasks
            where project_id = 'a4220000-0000-0000-0000-000000000000'
              and title = '1.1. Groundworks' and assignee_id is null
              and boq_section_id = 'a4341000-0000-0000-0000-000000000000'),
    'gen: task titled from depth-first numbering, unassigned, traced to section');
  perform pg_temp.ok(
    exists (select 1 from public.task_subtasks
            where boq_item_id = 'a4350000-0000-0000-0000-000000000000'
              and title like '1.6 Excavate%' and cost_cents = 2500),
    'gen: subtask keeps imported item_no + budget pricing');
  perform pg_temp.ok(
    (select project_id from public.boqs where id = 'a4330000-0000-0000-0000-000000000000')
      = 'a4220000-0000-0000-0000-000000000000',
    'gen: BOQ linked to the project');
end $$;

-- Second generate is blocked (idempotent).
do $$
begin
  perform public.generate_tasks_from_boq('a4330000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000');
  raise exception 'FAIL: gen: double generate not blocked';
exception when others then
  if position('already generated' in SQLERRM) > 0 then raise notice 'PASS: gen: double generate blocked.';
  else raise; end if;
end $$;
reset role;
reset request.jwt.claims;

-- Assigning a generated task must NOT wipe its bill lines: the reassignment-
-- cleanup trigger (set_task_pending_on_assign) now keeps boq_item_id subtasks
-- and clears only personal-plan lines. Contractor a2 is enrolled, then assigned.
insert into public.project_members (org_id, project_id, user_id, role) values
  ('a1110000-0000-0000-0000-000000000000','a4220000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a2','contractor');
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v_task uuid;
begin
  select t.id into v_task from public.tasks t
    where t.project_id = 'a4220000-0000-0000-0000-000000000000'
      and t.boq_section_id = 'a4341000-0000-0000-0000-000000000000';
  update public.tasks set assignee_id = 'a0000000-0000-0000-0000-0000000000a2' where id = v_task;
  perform pg_temp.ok(
    (select count(*) from public.task_subtasks where task_id = v_task and boq_item_id is not null) = 2,
    'assign: BOQ-generated subtasks survive assignment');
  perform pg_temp.ok(
    (select acceptance_status from public.tasks where id = v_task) = 'pending',
    'assign: acceptance goes pending for the contractor as before');
  -- roll the assignment back for the reprice test below (fresh unassigned task)
  update public.tasks set assignee_id = null, acceptance_status = null where id = v_task;
end $$;
reset role;
reset request.jwt.claims;

-- ── Project↔BOQ: award repricing of pre-generated tasks ───────────────────────
-- Reuses the a4… fixtures: BOQ Gen is linked to Gen Project and holds generated
-- unassigned tasks. A tender awarded to contractor a2 must take REPRICE mode:
-- assign the winner, move priced lines to bid rates, keep no-bid lines at
-- budget, and never create a new project.
insert into public.boq_tenders (id, org_id, boq_id, title, status, unsealed_at) values
  ('a4360000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4330000-0000-0000-0000-000000000000','Gen Tender','awarded', now());
insert into public.boq_bidders (id, org_id, tender_id, company_name, contact_email, invite_token, user_id, status, submitted_at) values
  ('a4370000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a4360000-0000-0000-0000-000000000000','Winner A Ltd','contractor-a@test.dev','tok-a437','a0000000-0000-0000-0000-0000000000a2','submitted', now());
update public.boq_tenders set awarded_bidder_id = 'a4370000-0000-0000-0000-000000000000'
  where id = 'a4360000-0000-0000-0000-000000000000';
-- Winner prices Excavate (400/unit); no-bids Backfill (stays at budget;
-- rate_cents is NOT NULL so a no-bid row carries 0 + the flag).
insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid) values
  ('a1110000-0000-0000-0000-000000000000','a4370000-0000-0000-0000-000000000000','a4350000-0000-0000-0000-000000000000',400,false),
  ('a1110000-0000-0000-0000-000000000000','a4370000-0000-0000-0000-000000000000','a4351000-0000-0000-0000-000000000000',0,true);

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v jsonb;
begin
  select public.export_award_to_project('a4360000-0000-0000-0000-000000000000', null, null) into v;
  perform pg_temp.ok(v->>'mode' = 'repriced', 'reprice: linked BOQ with tasks takes reprice mode');
  perform pg_temp.ok((v->>'project_id')::uuid = 'a4220000-0000-0000-0000-000000000000',
    'reprice: no new project — the linked project is used');
  perform pg_temp.ok((v->>'budget_kept_lines')::int = 1, 'reprice: no-bid line kept at budget, reported');
  perform pg_temp.ok(
    (select cost_cents from public.task_subtasks where boq_item_id = 'a4350000-0000-0000-0000-000000000000') = 4000,
    'reprice: priced line moved to bid rate (10×400)');
  perform pg_temp.ok(
    (select cost_cents from public.task_subtasks where boq_item_id = 'a4351000-0000-0000-0000-000000000000') = 400,
    'reprice: no-bid line still at budget (4×100)');
  perform pg_temp.ok(
    exists (select 1 from public.tasks
            where project_id = 'a4220000-0000-0000-0000-000000000000'
              and boq_section_id = 'a4341000-0000-0000-0000-000000000000'
              and assignee_id = 'a0000000-0000-0000-0000-0000000000a2'
              and acceptance_status = 'accepted'
              and awarded_cost_cents = 4400),
    'reprice: task assigned to winner, accepted, cost locked to subtask sum');
end $$;
reset role;
reset request.jwt.claims;

-- ── BOQ programme: durations, dependencies, scheduler, bill-line guard ────────
-- Fresh a7… fixtures: bill with A (2+3d), B (4d, after A), C (2d, independent).
reset role; reset request.jwt.claims;
insert into public.boqs (id, org_id, name) values
  ('a7330000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','BOQ Prog');
insert into public.boq_sections (id, org_id, boq_id, name, position) values
  ('a7340000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7330000-0000-0000-0000-000000000000','A Substructure', 0),
  ('a7341000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7330000-0000-0000-0000-000000000000','B Superstructure', 1),
  ('a7342000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7330000-0000-0000-0000-000000000000','C Siteworks', 2);
insert into public.boq_items (id, org_id, section_id, description, qty, budget_rate_cents, duration_days) values
  ('a7350000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7340000-0000-0000-0000-000000000000','Excavate',1,100,2),
  ('a7351000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7340000-0000-0000-0000-000000000000','Concrete',1,100,3),
  ('a7352000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7341000-0000-0000-0000-000000000000','Brickwork',1,100,4),
  ('a7353000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','a7342000-0000-0000-0000-000000000000','Paving',1,100,2);
insert into public.boq_section_deps (org_id, section_id, depends_on_id) values
  ('a1110000-0000-0000-0000-000000000000','a7341000-0000-0000-0000-000000000000','a7340000-0000-0000-0000-000000000000');
insert into public.projects (id, org_id, name) values
  ('a7220000-0000-0000-0000-000000000000','a1110000-0000-0000-0000-000000000000','Prog Project');

-- Cycle guard on the dep table itself.
do $$
begin
  insert into public.boq_section_deps (org_id, section_id, depends_on_id) values
    ('a1110000-0000-0000-0000-000000000000','a7340000-0000-0000-0000-000000000000','a7341000-0000-0000-0000-000000000000');
  raise exception 'FAIL: prog: dependency cycle accepted';
exception when others then
  if position('loop' in SQLERRM) > 0 then raise notice 'PASS: prog: dependency cycle rejected.';
  else raise; end if;
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
do $$
declare v jsonb; v_a_end date; v_b_start date; v_b_end date; v_c_start date;
begin
  perform public.generate_tasks_from_boq('a7330000-0000-0000-0000-000000000000','a7220000-0000-0000-0000-000000000000');
  perform pg_temp.ok(
    (select agreed_duration_days from public.tasks where boq_section_id = 'a7340000-0000-0000-0000-000000000000') = 5,
    'prog: durations roll up (2+3 = 5 days)');
  perform pg_temp.ok(
    exists (select 1 from public.task_dependencies d
            join public.tasks ts on ts.id = d.successor_id
            join public.tasks tp on tp.id = d.predecessor_id
            where ts.boq_section_id = 'a7341000-0000-0000-0000-000000000000'
              and tp.boq_section_id = 'a7340000-0000-0000-0000-000000000000'),
    'prog: section link copied to task_dependencies');

  select public.schedule_boq_tasks('a7220000-0000-0000-0000-000000000000','a7330000-0000-0000-0000-000000000000', current_date) into v;
  perform pg_temp.ok((v->>'scheduled')::int = 3, 'prog: scheduler placed all 3 tasks');
  select planned_end_date into v_a_end from public.tasks where boq_section_id = 'a7340000-0000-0000-0000-000000000000';
  select planned_start_date, planned_end_date into v_b_start, v_b_end from public.tasks where boq_section_id = 'a7341000-0000-0000-0000-000000000000';
  select planned_start_date into v_c_start from public.tasks where boq_section_id = 'a7342000-0000-0000-0000-000000000000';
  perform pg_temp.ok(v_c_start = current_date, 'prog: independent section starts day one (concurrent)');
  perform pg_temp.ok(v_b_start = v_a_end + 1 and v_b_end = v_b_start + 3,
    'prog: dependent section chains after its predecessor');
  perform pg_temp.ok(
    (select due_date from public.tasks where boq_section_id = 'a7341000-0000-0000-0000-000000000000') = v_b_end,
    'prog: due_date = planned end (SLA)');
end $$;
reset role; reset request.jwt.claims;

-- Bill-line guard: the assignee can tick, but never delete or reprice bill lines.
insert into public.project_members (org_id, project_id, user_id, role) values
  ('a1110000-0000-0000-0000-000000000000','a7220000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a2','contractor');
update public.tasks set assignee_id = 'a0000000-0000-0000-0000-0000000000a2'
  where boq_section_id = 'a7340000-0000-0000-0000-000000000000';
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
do $$
declare v_line uuid;
begin
  select id into v_line from public.task_subtasks where boq_item_id = 'a7350000-0000-0000-0000-000000000000';
  begin
    delete from public.task_subtasks where id = v_line;
    raise exception 'FAIL: prog guard: contractor deleted a bill line';
  exception when others then
    if position('variation' in SQLERRM) > 0 then raise notice 'PASS: prog guard: bill-line delete blocked.';
    else raise; end if;
  end;
  begin
    update public.task_subtasks set cost_cents = 1 where id = v_line;
    raise exception 'FAIL: prog guard: contractor repriced a bill line';
  exception when others then
    if position('fixed scope' in SQLERRM) > 0 then raise notice 'PASS: prog guard: bill-line reprice blocked.';
    else raise; end if;
  end;
  update public.task_subtasks set is_done = true, done_at = now() where id = v_line;
  perform pg_temp.ok(
    (select is_done from public.task_subtasks where id = v_line) = true,
    'prog guard: contractor can still tick a bill line done');
end $$;
reset role; reset request.jwt.claims;

-- ── Guarded-column writers (see docs/DB-WORKFLOW-GUARDS.md). Any SECURITY DEFINER
--    RPC that changes a guarded workflow column (tasks.plan_approved_at, etc.) must
--    set app.workflow_ctx first, and MUST be exercised here — CI's happy path won't
--    catch a writer that this suite never calls. Add a case when you add a writer.

-- ── award_tender: per-task tender award must set tasks.plan_approved_at past the
--    phase-1 guard_workflow_transition (regression for 20260826000010 — the RPC
--    must set app.workflow_ctx, like finalize_approval / export_award_to_project).
--    Reuses org A (a111…), project A (a222…) and owner user A (a000…a1) as PM.
insert into public.project_members (org_id, project_id, user_id, role) values
  ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a2','contractor');
insert into public.tasks (id, org_id, project_id, title) values
  ('a5000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','Award Tender Task');
insert into public.task_tender_invites (id, org_id, project_id, task_id, contractor_id, status, invited_at) values
  ('a5000000-0000-0000-0000-000000000002','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000',
   'a5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a2','invited', now());
-- The contractor seals a whole-task bid: one price + a works note (20260826000012).
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select public.submit_tender_bid('a5000000-0000-0000-0000-000000000001', 180000, 'Tender works description');
select pg_temp.ok(
  (select status = 'submitted' and bid_price_cents = 180000
     from public.task_tender_invites where id = 'a5000000-0000-0000-0000-000000000002'),
  'submit_tender_bid: whole-task price + note sealed on the invite');
reset request.jwt.claims;
-- The PM awards; the winner's bid price + note lock onto the task.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select public.award_tender('a5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select plan_approved_at is not null and assignee_id = 'a0000000-0000-0000-0000-0000000000a2'
          and awarded_cost_cents = 180000 and works_notes = 'Tender works description'
     from public.tasks where id = 'a5000000-0000-0000-0000-000000000001'),
  'award_tender: winner assigned + plan approved + bid price/note locked (workflow_ctx set past the phase-1 guard)');
select pg_temp.ok(
  (select status from public.task_tender_invites where id = 'a5000000-0000-0000-0000-000000000002') = 'awarded',
  'award_tender: winning invite marked awarded');
reset request.jwt.claims;

-- ── accept_and_price_task: whole-task pricing must set plan_approved_at past the
--    phase-1 guard (regression for 20260826000011 — the contractor's accept-&-lock
--    RPC must set app.workflow_ctx). The pending assignee (contractor a2) accepts.
insert into public.tasks (id, org_id, project_id, title, assignee_id, acceptance_status) values
  ('a5000000-0000-0000-0000-000000000003','a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000',
   'Whole-price Task','a0000000-0000-0000-0000-0000000000a2','pending');
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select public.accept_and_price_task('a5000000-0000-0000-0000-000000000003', 250000, 'Full works description');
select pg_temp.ok(
  (select acceptance_status = 'accepted' and plan_approved_at is not null
          and awarded_cost_cents = 250000 and works_notes = 'Full works description'
     from public.tasks where id = 'a5000000-0000-0000-0000-000000000003'),
  'accept_and_price_task: accepted + priced + plan locked (workflow_ctx set past the phase-1 guard)');
reset request.jwt.claims;

-- ── Ledger delete-protection: committed money + audit trail are permanent ────
-- The guards are BEFORE DELETE/UPDATE triggers, so they fire regardless of role;
-- these run as the seeding superuser. Reuses the committed task a500…0003
-- (accepted + priced + plan-approved above). See 20260826000020.
reset role;

-- A committed (plan-approved, awarded) task cannot be deleted.
do $$
begin
  delete from public.tasks where id = 'a5000000-0000-0000-0000-000000000003';
  raise exception 'FAIL: a committed (awarded) task was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: ledger: committed task delete blocked';
end $$;
select pg_temp.ok(
  (select count(*) from public.tasks where id = 'a5000000-0000-0000-0000-000000000003') = 1,
  'ledger: committed task still present after blocked delete');

-- A draft task (no awarded amount, no plan approval) is still freely deletable,
-- so the guard doesn't over-block ordinary editing.
insert into public.tasks (id, org_id, project_id, title) values
  ('a5000000-0000-0000-0000-0000000000d1','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','Draft task');
delete from public.tasks where id = 'a5000000-0000-0000-0000-0000000000d1';
select pg_temp.ok(
  (select count(*) from public.tasks where id = 'a5000000-0000-0000-0000-0000000000d1') = 0,
  'ledger: a draft task is still deletable (guard does not over-block)');

-- Progress-linked payments: nothing is claimable at 0% progress; a completed task
-- (100%) unlocks the full awarded value less retention. This also brings the task
-- to a state where the ledger claims below can be raised.
select pg_temp.ok(
  public.task_payment_entitlement_cents('a5000000-0000-0000-0000-000000000003'::uuid) = 0,
  'progress-pay: nothing claimable at 0% progress');
update public.projects set retention_pct = 10 where id = 'a2220000-0000-0000-0000-000000000000';
update public.tasks set status = 'done' where id = 'a5000000-0000-0000-0000-000000000003';
select pg_temp.ok(
  public.task_payment_entitlement_cents('a5000000-0000-0000-0000-000000000003'::uuid) = 225000,
  'progress-pay: at 100% with 10% retention, entitlement = 250000 − 25000');

-- Payment requests are permanent: an approved one cannot be deleted; a pending
-- one is withdrawn by a status change to cancelled, never a delete.
-- invoice_path is required by enforce_payment_request_insert; the task
-- a500…0003 is now done (100%), awarded 250000, and assigned to contractor a2.
insert into public.contractor_payment_requests
  (id, org_id, project_id, task_id, contractor_id, title, amount_cents, invoice_path, status) values
  ('a6000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','a5000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-0000000000a2','Claim 1',100000,'inv/claim1.pdf','approved'),
  ('a6000000-0000-0000-0000-000000000002','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','a5000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-0000000000a2','Claim 2',50000,'inv/claim2.pdf','requested');
do $$
begin
  delete from public.contractor_payment_requests where id = 'a6000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: an approved payment request was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: ledger: approved payment request delete blocked';
end $$;
update public.contractor_payment_requests set status = 'cancelled'
  where id = 'a6000000-0000-0000-0000-000000000002';
select pg_temp.ok(
  (select status::text from public.contractor_payment_requests
     where id = 'a6000000-0000-0000-0000-000000000002') = 'cancelled',
  'ledger: a pending payment request is withdrawn to cancelled (row kept)');
select pg_temp.ok(
  (select count(*) from public.contractor_payment_requests
     where id in ('a6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002')) = 2,
  'ledger: both payment requests remain on record');

-- The audit trail is append-only: audit_logs cannot be deleted OR updated.
insert into public.audit_logs (id, org_id, entity_type, action) values
  ('a7000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000','ledger_test','created');
do $$
begin
  delete from public.audit_logs where id = 'a7000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: an audit_logs row was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: ledger: audit_logs delete blocked';
end $$;
do $$
begin
  update public.audit_logs set action = 'tampered' where id = 'a7000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: an audit_logs row was updated';
exception when insufficient_privilege then
  raise notice 'PASS: ledger: audit_logs update blocked';
end $$;

-- task_activity is append-only too (delete blocked).
insert into public.task_activity (id, org_id, task_id, type, message) values
  ('a7000000-0000-0000-0000-000000000002','a1110000-0000-0000-0000-000000000000',
   'a5000000-0000-0000-0000-000000000003','test','ledger test entry');
do $$
begin
  delete from public.task_activity where id = 'a7000000-0000-0000-0000-000000000002';
  raise exception 'FAIL: a task_activity row was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: ledger: task_activity delete blocked';
end $$;

-- ── Retention release: held retention is claimable only after the defects-
--    liability period, less anything the PM spent on repairs. (20260826000023)
--    Contractor a2 holds retention on the done task a500…0003: 10% of 250000 =
--    25000. Task a500…0001 is 0% (no subtasks) so withholds nothing.
select pg_temp.ok(
  public.task_retention_withheld_cents('a5000000-0000-0000-0000-000000000003'::uuid) = 25000,
  'retention: 10% of a completed 250000 task is withheld (25000)');
select pg_temp.ok(
  public.project_contractor_retention_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid) = 25000,
  'retention: contractor pool sums withheld across their approved tasks (25000)');

-- Not releasable before practical completion; a retention claim is rejected.
select pg_temp.ok(
  public.project_retention_releasable('a2220000-0000-0000-0000-000000000000'::uuid) = false,
  'retention: not releasable before practical completion');
do $$
begin
  insert into public.contractor_payment_requests
    (org_id, project_id, task_id, kind, contractor_id, title, amount_cents, invoice_path, status)
  values ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000', null,
          'retention','a0000000-0000-0000-0000-0000000000a2','Retention (early)',25000,'inv/ret.pdf','requested');
  raise exception 'FAIL: retention claim accepted before the period elapsed';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: retention: early claim blocked (%)', sqlerrm;
end $$;

-- Agree a 6-month period, then stamp practical completion via the RPC (owner a1).
update public.projects set retention_period_months = 6
  where id = 'a2220000-0000-0000-0000-000000000000';
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select public.mark_practical_completion('a2220000-0000-0000-0000-000000000000');
reset request.jwt.claims;
select pg_temp.ok(
  (select practical_completion_at is not null and status = 'completed'
     from public.projects where id = 'a2220000-0000-0000-0000-000000000000'),
  'retention: mark_practical_completion stamps the date and completes the project');
-- Just stamped (now) with a 6-month period → still not releasable.
select pg_temp.ok(
  public.project_retention_releasable('a2220000-0000-0000-0000-000000000000'::uuid) = false,
  'retention: not releasable until the agreed period elapses');

-- Back-date completion a year → the 6-month period has elapsed → releasable.
update public.projects set practical_completion_at = now() - interval '12 months'
  where id = 'a2220000-0000-0000-0000-000000000000';
select pg_temp.ok(
  public.project_retention_releasable('a2220000-0000-0000-0000-000000000000'::uuid) = true,
  'retention: releasable once practical completion + period has elapsed');
select pg_temp.ok(
  public.project_contractor_retention_available_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid,'a0000000-0000-0000-0000-0000000000a2'::uuid) = 25000,
  'retention: full pool available before any deduction (25000)');

-- The PM spends 10000 on repairs → available drops to 15000.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select public.record_retention_deduction(
  'a2220000-0000-0000-0000-000000000000'::uuid,'a0000000-0000-0000-0000-0000000000a2'::uuid,
  10000, 'Re-grout failed tiling');
reset request.jwt.claims;
select pg_temp.ok(
  public.project_contractor_retention_available_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid,'a0000000-0000-0000-0000-0000000000a2'::uuid) = 15000,
  'retention: a 10000 repair deduction reduces available to 15000');

-- A retention claim within the net available is accepted; a further cent is rejected.
insert into public.contractor_payment_requests
  (id, org_id, project_id, task_id, kind, contractor_id, title, amount_cents, invoice_path, status) values
  ('a6000000-0000-0000-0000-000000000003','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', null, 'retention','a0000000-0000-0000-0000-0000000000a2',
   'Retention release',15000,'inv/ret.pdf','requested');
select pg_temp.ok(
  (select amount_cents from public.contractor_payment_requests
     where id = 'a6000000-0000-0000-0000-000000000003') = 15000,
  'retention: a claim within net available is accepted');
do $$
begin
  insert into public.contractor_payment_requests
    (org_id, project_id, task_id, kind, contractor_id, title, amount_cents, invoice_path, status)
  values ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000', null,
          'retention','a0000000-0000-0000-0000-0000000000a2','Retention (over)',1,'inv/ret.pdf','requested');
  raise exception 'FAIL: retention claim exceeding net available accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: retention: over-claim blocked (%)', sqlerrm;
end $$;

-- A retention deduction is a permanent record — it cannot be deleted.
do $$
begin
  delete from public.retention_deductions
    where project_id = 'a2220000-0000-0000-0000-000000000000';
  raise exception 'FAIL: a retention deduction was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: retention: deduction delete blocked';
end $$;

-- ── Advances: issued money is recouped from progress claims (full offset) ─────
--    (20260826000025) Contractor a2 has earned 225000 on project A (task …0003 net
--    of 10% retention); task …0001 is 0% so earns nothing. They've already claimed
--    100000 (Claim 1, approved). Cash claimable = Σ entitlement − advance − claimed.
select pg_temp.ok(
  public.project_contractor_entitlement_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid) = 225000,
  'advance: project entitlement sums each task''s entitlement (225000)');
select pg_temp.ok(
  public.project_contractor_advance_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid) = 0,
  'advance: none issued yet');

-- Issue a 50000 advance (owner a1). Ceiling = 225000 − 50000 = 175000; with 100000
-- already claimed, 75000 of new cash remains.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select public.issue_contractor_advance(
  'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid,
  50000, 'chq 001', 'Mobilisation');
reset request.jwt.claims;
select pg_temp.ok(
  public.project_contractor_advance_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid) = 50000,
  'advance: issued advance recorded (50000)');

-- A progress claim within the recoupment ceiling is accepted (75000 more).
insert into public.contractor_payment_requests
  (id, org_id, project_id, task_id, kind, contractor_id, title, amount_cents, invoice_path, status) values
  ('a6000000-0000-0000-0000-000000000004','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','a5000000-0000-0000-0000-000000000003','milestone',
   'a0000000-0000-0000-0000-0000000000a2','Claim 3',75000,'inv/claim3.pdf','requested');
select pg_temp.ok(
  (select amount_cents from public.contractor_payment_requests
     where id = 'a6000000-0000-0000-0000-000000000004') = 75000,
  'advance: a progress claim within the recoupment ceiling is accepted');

-- A further cent is blocked — the advance must be recouped before more cash flows.
do $$
begin
  insert into public.contractor_payment_requests
    (org_id, project_id, task_id, kind, contractor_id, title, amount_cents, invoice_path, status)
  values ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000',
          'a5000000-0000-0000-0000-000000000003','milestone',
          'a0000000-0000-0000-0000-0000000000a2','Claim over',1,'inv/claim4.pdf','requested');
  raise exception 'FAIL: progress claim past the advance ceiling accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: advance: over-ceiling claim blocked (%)', sqlerrm;
end $$;

-- Cancelling the advance (owner a1) frees the offset; the balance is claimable again.
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select public.cancel_contractor_advance(
  (select id from public.contractor_advances
     where project_id = 'a2220000-0000-0000-0000-000000000000'
       and contractor_id = 'a0000000-0000-0000-0000-0000000000a2' and status = 'active'
     limit 1), 'issued in error');
reset request.jwt.claims;
select pg_temp.ok(
  public.project_contractor_advance_cents(
    'a2220000-0000-0000-0000-000000000000'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid) = 0,
  'advance: cancelling removes it from the outstanding offset');

-- An advance is a permanent record — it cannot be deleted (only cancelled).
do $$
begin
  delete from public.contractor_advances
    where project_id = 'a2220000-0000-0000-0000-000000000000';
  raise exception 'FAIL: an advance was deleted';
exception when insufficient_privilege then
  raise notice 'PASS: advance: delete blocked';
end $$;

-- ── Action items: lightweight chat to-dos, scoped to project members ─────────
--    (20260826000028) a2 is a member of project A; b1 is in org B (a non-member).
reset role;
reset request.jwt.claims;

-- A project member raises a to-do (RLS insert: created_by = self + member of scope).
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.action_items (id, org_id, project_id, title, assignee_id, created_by, due_date) values
  ('a9000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','Send the revised BOQ',
   'a0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-0000000000a2', current_date + 3);
select pg_temp.ok(
  (select count(*) from public.action_items where id = 'a9000000-0000-0000-0000-000000000001') = 1,
  'action-items: a project member can raise and see a to-do');
reset role;
reset request.jwt.claims;

-- A user from another org cannot see the project's to-dos.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.action_items where id = 'a9000000-0000-0000-0000-000000000001') = 0,
  'action-items: a non-member cannot see the project''s to-dos');
reset role;
reset request.jwt.claims;

-- The assignee marks it done.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
update public.action_items set status = 'done', done_at = now(), done_by = 'a0000000-0000-0000-0000-0000000000a2'
  where id = 'a9000000-0000-0000-0000-000000000001';
select pg_temp.ok(
  (select status from public.action_items where id = 'a9000000-0000-0000-0000-000000000001') = 'done',
  'action-items: the assignee can mark a to-do done');
reset role;
reset request.jwt.claims;

-- ── Project events: meetings/site visits scoped to project members ───────────
--    (20260826000029) a2 is a member of project A; b1 is in org B (a non-member).
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.project_events (id, org_id, project_id, title, kind, starts_at, created_by) values
  ('aa000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','Site meeting','site_visit', now() + interval '2 days',
   'a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.project_events where id = 'aa000000-0000-0000-0000-000000000001') = 1,
  'events: a project member can schedule and see an event');
-- Add an attendee (added_by self), then save the minutes.
insert into public.event_attendees (event_id, org_id, project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-0000000000a2');
update public.project_events set notes = 'Discussed the phase 2 BOQ' where id = 'aa000000-0000-0000-0000-000000000001';
select pg_temp.ok(
  (select notes from public.project_events where id = 'aa000000-0000-0000-0000-000000000001') = 'Discussed the phase 2 BOQ',
  'events: the organiser can save meeting notes');
reset role;
reset request.jwt.claims;

-- A user from another org cannot see the project's events.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.project_events where id = 'aa000000-0000-0000-0000-000000000001') = 0,
  'events: a non-member cannot see the project''s events');
reset role;
reset request.jwt.claims;

-- ── Chat About Topic: only managers (org staff / project PM) may edit ────────
--    (20260826000030) conversations_write gates topic/description/note. Project A's
--    chat conversation is auto-created by the create_project_chat trigger.
reset role;
reset request.jwt.claims;
-- A contractor (a2) cannot change the topic — the RLS update matches no rows.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
update public.conversations set topic = 'hijack'
  where project_id = 'a2220000-0000-0000-0000-000000000000' and type = 'project';
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  coalesce((select topic from public.conversations
     where project_id = 'a2220000-0000-0000-0000-000000000000' and type = 'project'), '') <> 'hijack',
  'about: a contractor cannot edit the chat topic');

-- The owner (a1, org staff) can.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
update public.conversations set topic = 'Phase 2 coordination'
  where project_id = 'a2220000-0000-0000-0000-000000000000' and type = 'project';
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  (select topic from public.conversations
     where project_id = 'a2220000-0000-0000-0000-000000000000' and type = 'project') = 'Phase 2 coordination',
  'about: a manager can edit the chat topic');

-- ── Pinned messages: a member can pin & see; a non-member cannot ─────────────
--    (20260826000031) message_pins mirror reactions — scope is denormalized from
--    the parent message and RLS double-gates via can_access_chat.
reset role;
reset request.jwt.claims;
-- Contractor a2 (a project A member) posts a message in the project chat, then pins it.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.messages (id, conversation_id, sender_id, body)
select 'ab000000-0000-0000-0000-000000000001', c.id, 'a0000000-0000-0000-0000-0000000000a2', 'Key decision'
  from public.conversations c
  where c.project_id = 'a2220000-0000-0000-0000-000000000000' and c.type = 'project';
insert into public.message_pins (message_id, pinned_by) values
  ('ab000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.message_pins where message_id = 'ab000000-0000-0000-0000-000000000001') = 1,
  'pins: a member can pin a message and see it');
reset role;
reset request.jwt.claims;

-- A user from another org cannot see the pin.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.message_pins where message_id = 'ab000000-0000-0000-0000-000000000001') = 0,
  'pins: a non-member cannot see the pin');
reset role;
reset request.jwt.claims;

-- ── Site diary: a member can log & see; a non-member cannot ──────────────────
--    (20260826000032) site_diary_entries mirror project_events — members/staff
--    read; the author or a manager writes. A photo row denormalizes scope from
--    the entry's org.
reset role;
reset request.jwt.claims;
-- Contractor a2 (a project A member) logs today's diary and attaches a photo row.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.site_diary_entries (id, org_id, project_id, entry_date, weather, labour_count, notes, created_by) values
  ('ad000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', current_date, 'Overcast', 12, 'Poured slab grid C4-C7',
   'a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.site_diary_entries where id = 'ad000000-0000-0000-0000-000000000001') = 1,
  'diary: a project member can log an entry and see it');
insert into public.site_diary_photos (entry_id, org_id, project_id, storage_path, uploaded_by) values
  ('ad000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000',
   'a1110000-0000-0000-0000-000000000000/a2220000-0000-0000-0000-000000000000/diary/ad000000-0000-0000-0000-000000000001/x.jpg',
   'a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.site_diary_photos where entry_id = 'ad000000-0000-0000-0000-000000000001') = 1,
  'diary: the author can attach a photo to their entry');
reset role;
reset request.jwt.claims;

-- A user from another org cannot see the diary entry.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.site_diary_entries where id = 'ad000000-0000-0000-0000-000000000001') = 0,
  'diary: a non-member cannot see the entry');
reset role;
reset request.jwt.claims;

-- ── Snagging: a member can raise & see; the assignee acts; a non-member cannot ─
--    (20260826000033) snags mirror site_diary — members/staff read; the raiser,
--    the assignee, or a manager write. The per-project number is set by trigger.
reset role;
reset request.jwt.claims;
-- Contractor a2 (a project A member) raises a snag assigned to themselves.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.snags (id, org_id, project_id, title, severity, assignee_id, raised_by) values
  ('ae000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', 'Grout cracking to tiling', 'major',
   'a0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.snags where id = 'ae000000-0000-0000-0000-000000000001') = 1,
  'snags: a project member can raise a snag and see it');
select pg_temp.ok(
  (select number from public.snags where id = 'ae000000-0000-0000-0000-000000000001') = 1,
  'snags: the per-project number trigger assigns #1');
-- The assignee marks it fixed (RLS update permits the assignee).
update public.snags set status = 'fixed', fixed_at = now()
  where id = 'ae000000-0000-0000-0000-000000000001';
select pg_temp.ok(
  (select status from public.snags where id = 'ae000000-0000-0000-0000-000000000001') = 'fixed',
  'snags: the assignee can mark a snag fixed');
insert into public.snag_photos (snag_id, org_id, project_id, storage_path, uploaded_by) values
  ('ae000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000',
   'a1110000-0000-0000-0000-000000000000/a2220000-0000-0000-0000-000000000000/snags/ae000000-0000-0000-0000-000000000001/x.jpg',
   'a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.snag_photos where snag_id = 'ae000000-0000-0000-0000-000000000001') = 1,
  'snags: a member can attach a photo to a snag');
reset role;
reset request.jwt.claims;

-- Org-B outsider b1 cannot see the snag.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.snags where id = 'ae000000-0000-0000-0000-000000000001') = 0,
  'snags: a non-member cannot see the snag');
reset role;
reset request.jwt.claims;

-- ── Drawings register: managers write; members read; outsiders can't ─────────
--    (20260826000035) drawings + drawing_revisions — the controlled register.
reset role;
reset request.jwt.claims;
-- Owner a1 (org staff) adds a drawing and issues Rev A.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
insert into public.drawings (id, org_id, project_id, number, title, discipline, created_by) values
  ('af000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', 'S-101', 'Foundation plan', 'structural',
   'a0000000-0000-0000-0000-0000000000a1');
insert into public.drawing_revisions (id, drawing_id, org_id, project_id, revision, status, storage_path, uploaded_by) values
  ('af000000-0000-0000-0000-0000000000a1','af000000-0000-0000-0000-000000000001',
   'a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','A','for_construction',
   'a1110000-0000-0000-0000-000000000000/a2220000-0000-0000-0000-000000000000/drawings/af000000-0000-0000-0000-000000000001/revA.pdf',
   'a0000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(
  (select count(*) from public.drawings where id = 'af000000-0000-0000-0000-000000000001') = 1,
  'drawings: a manager can add a drawing and see it');
reset role;
reset request.jwt.claims;

-- Contractor a2 (a project A member) can view the register and download.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.drawing_revisions where drawing_id = 'af000000-0000-0000-0000-000000000001') = 1,
  'drawings: a project member can view a drawing revision');
reset role;
reset request.jwt.claims;

-- Org-B outsider b1 cannot see the drawing.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.drawings where id = 'af000000-0000-0000-0000-000000000001') = 0,
  'drawings: a non-member cannot see the drawing');
reset role;
reset request.jwt.claims;

-- ── RFIs: a member raises & sees; the responder answers; outsiders can't ─────
--    (20260826000036) rfis mirror snags — members/staff read; raiser, responder
--    or a manager write. The per-project number is set by trigger.
reset role;
reset request.jwt.claims;
-- Contractor a2 (a project A member) raises an RFI, assigned to themselves.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.rfis (id, org_id, project_id, subject, discipline, priority, assignee_id, raised_by) values
  ('bf000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', 'Grid C beam depth vs. M&E duct', 'structural', 'high',
   'a0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.rfis where id = 'bf000000-0000-0000-0000-000000000001') = 1,
  'rfis: a project member can raise an RFI and see it');
select pg_temp.ok(
  (select number from public.rfis where id = 'bf000000-0000-0000-0000-000000000001') = 1,
  'rfis: the per-project number trigger assigns #1');
-- The responder answers it (RLS update permits the assignee).
update public.rfis set answer = 'Coordinate the duct below the beam soffit.', answered_at = now(),
       answered_by = 'a0000000-0000-0000-0000-0000000000a2', status = 'answered'
  where id = 'bf000000-0000-0000-0000-000000000001';
select pg_temp.ok(
  (select status from public.rfis where id = 'bf000000-0000-0000-0000-000000000001') = 'answered',
  'rfis: the responder can record an answer');
reset role;
reset request.jwt.claims;

-- Org-B outsider b1 cannot see the RFI.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.rfis where id = 'bf000000-0000-0000-0000-000000000001') = 0,
  'rfis: a non-member cannot see the RFI');
reset role;
reset request.jwt.claims;

-- ── Variations: a member raises (submitted); a manager decides; outsiders can't ─
--    (20260826000037) variation_orders gains a per-project number trigger. RLS is
--    the existing can_view_project (read) / can_manage_project (approve) gate.
reset role;
reset request.jwt.claims;
-- Contractor a2 (a project A member) raises a submitted variation.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
insert into public.variation_orders (id, org_id, project_id, description, cost_impact_cents, time_impact_days, status, created_by) values
  ('c9000000-0000-0000-0000-000000000001','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000', 'Add waterproofing to the basement retaining wall', 1240000, 5, 'submitted',
   'a0000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(
  (select count(*) from public.variation_orders where id = 'c9000000-0000-0000-0000-000000000001') = 1,
  'variations: a project member can raise a submitted variation and see it');
select pg_temp.ok(
  (select number from public.variation_orders where id = 'c9000000-0000-0000-0000-000000000001') = 1,
  'variations: the per-project number trigger assigns #1');
reset role;
reset request.jwt.claims;

-- The owner a1 (a manager) approves it.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
update public.variation_orders
   set status = 'approved', approved_by = 'a0000000-0000-0000-0000-0000000000a1', approved_at = now(), decided_at = now()
 where id = 'c9000000-0000-0000-0000-000000000001';
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  (select status from public.variation_orders where id = 'c9000000-0000-0000-0000-000000000001') = 'approved',
  'variations: a manager can approve a variation');

-- Org-B outsider b1 cannot see it.
set role authenticated;
set request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select pg_temp.ok(
  (select count(*) from public.variation_orders where id = 'c9000000-0000-0000-0000-000000000001') = 0,
  'variations: a non-member cannot see the variation');
reset role;
reset request.jwt.claims;

-- ── Weekly digest opt-in: self-service RPC flips only the caller's own flag ───
--    (20260826000034) org_members is owner/admin-managed, so the toggle goes via
--    set_weekly_digest_opt_in (SECURITY DEFINER, scoped to auth.uid()).
reset role;
reset request.jwt.claims;
-- Default is on for everyone.
select pg_temp.ok(
  (select weekly_digest_opt_in from public.org_members
     where org_id = 'a1110000-0000-0000-0000-000000000000'
       and user_id = 'a0000000-0000-0000-0000-0000000000a2') = true,
  'digest: opt-in defaults to true');

-- Contractor a2 opts themselves out.
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select public.set_weekly_digest_opt_in('a1110000-0000-0000-0000-000000000000', false);
reset role;
reset request.jwt.claims;
select pg_temp.ok(
  (select weekly_digest_opt_in from public.org_members
     where org_id = 'a1110000-0000-0000-0000-000000000000'
       and user_id = 'a0000000-0000-0000-0000-0000000000a2') = false,
  'digest: a member can opt themselves out');
-- The owner a1's flag is untouched — the RPC only ever flips the caller's row.
select pg_temp.ok(
  (select weekly_digest_opt_in from public.org_members
     where org_id = 'a1110000-0000-0000-0000-000000000000'
       and user_id = 'a0000000-0000-0000-0000-0000000000a1') = true,
  'digest: the toggle does not affect another member');

-- ── Project member disable revokes project access ────────────────────────────
-- A plain org member (not staff) added to a project as a contributor can see the
-- project while active; disabling their membership (status='disabled') must drop
-- is_project_member / project_role and cut off access, and re-enabling restores it.
reset role;
reset request.jwt.claims;
-- A CONTRACTOR (not internal staff — is_org_staff would grant org-wide project
-- visibility) so access is scoped to project membership, which is what disable
-- must revoke.
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000a9','proj-only@test.dev');
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('a1110000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a9','member','contractor','active');
insert into public.project_members (org_id, project_id, user_id, role, status) values
  ('a1110000-0000-0000-0000-000000000000','a2220000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a9','contributor','active');

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.projects where id = 'a2220000-0000-0000-0000-000000000000') = 1,
  'proj-member: active contributor can read the project');
select pg_temp.ok(public.project_role('a2220000-0000-0000-0000-000000000000'::uuid) = 'contributor',
  'proj-member: active contributor resolves role = contributor');
reset role;
reset request.jwt.claims;

-- Disable them (as superuser, mirroring the setProjectMemberStatus action).
update public.project_members set status = 'disabled'
  where project_id = 'a2220000-0000-0000-0000-000000000000' and user_id = 'a0000000-0000-0000-0000-0000000000a9';

set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.projects where id = 'a2220000-0000-0000-0000-000000000000') = 0,
  'proj-member: DISABLED member can no longer read the project');
select pg_temp.ok(public.project_role('a2220000-0000-0000-0000-000000000000'::uuid) is null,
  'proj-member: DISABLED member resolves no project role');
select pg_temp.ok(public.is_project_member('a2220000-0000-0000-0000-000000000000'::uuid) = false,
  'proj-member: DISABLED member is not a project member');
reset role;
reset request.jwt.claims;

-- Re-enable restores access.
update public.project_members set status = 'active'
  where project_id = 'a2220000-0000-0000-0000-000000000000' and user_id = 'a0000000-0000-0000-0000-0000000000a9';
set role authenticated;
set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal1"}';
select pg_temp.ok((select count(*) from public.projects where id = 'a2220000-0000-0000-0000-000000000000') = 1,
  'proj-member: re-enabled member can read the project again');
reset role;
reset request.jwt.claims;

-- ── BOQ subtasks are BASELINE scope, not variations (20260826000027) ──────────
-- set_subtask_variation_flag flags any subtask inserted into a plan-approved task
-- as a pending variation. Vetted generation (export_award_to_project etc.) sets
-- app.workflow_ctx before inserting the BOQ lines, so a task's own scope must land
-- BASELINE even though the plan is already approved; a later user-added subtask
-- (no ctx) into the same approved task is still flagged as a variation.
reset role;
insert into public.tasks (id, org_id, project_id, title, plan_approved_at) values
  ('a5000000-0000-0000-0000-0000000000b1','a1110000-0000-0000-0000-000000000000',
   'a2220000-0000-0000-0000-000000000000','Approved plan task', now());

-- Vetted generation context set → baseline regardless of plan_approved_at.
select set_config('app.workflow_ctx', 'a1110000-0000-0000-0000-000000000000'::text, true);
with ins as (
  insert into public.task_subtasks (org_id, task_id, title, cost_cents)
    values ('a1110000-0000-0000-0000-000000000000',
            'a5000000-0000-0000-0000-0000000000b1','Generated BOQ line', 5000)
  returning is_variation)
select pg_temp.ok((select is_variation from ins) = false,
  'boq-baseline: subtask inserted under app.workflow_ctx is baseline, not a variation');

-- No context (ordinary user add) → the approved-plan path flags it a variation.
select set_config('app.workflow_ctx', '', true);
with ins as (
  insert into public.task_subtasks (org_id, task_id, title, cost_cents)
    values ('a1110000-0000-0000-0000-000000000000',
            'a5000000-0000-0000-0000-0000000000b1','User-added extra', 3000)
  returning is_variation)
select pg_temp.ok((select is_variation from ins) = true,
  'boq-baseline: subtask added without ctx into an approved task is a variation');

rollback;

\echo '────────────────────────────────────────────'
\echo 'All RLS security regression checks passed.'
\echo '────────────────────────────────────────────'
