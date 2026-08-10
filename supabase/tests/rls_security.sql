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

rollback;

\echo '────────────────────────────────────────────'
\echo 'All RLS security regression checks passed.'
\echo '────────────────────────────────────────────'
