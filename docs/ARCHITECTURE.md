# Architecture decisions

Short, durable record of the choices that shape DatumPro. Update when a decision changes.

## 1. Multi-tenancy via Postgres RLS
Every tenant-owned row has `org_id`. Row-Level Security policies (see `supabase/migrations`) allow access only to active members of that org, so application code physically cannot leak across tenants by forgetting a `where org_id = …`. Access *capability* within a tenant is a separate concern (see #3).

- Helper functions (`is_org_member`, `org_role`, `shares_org`) are `SECURITY DEFINER` so policies can reference `org_members` without infinite RLS recursion. They are hardened with `set search_path = ''` + fully-qualified names (no search-path hijacking).
- New org → creator becomes `owner` via an `AFTER INSERT` trigger.

### Tenant-consistent references (security by design)
Every child of a project references it via the **composite key `(id, org_id)`**, so a
child row's `org_id` is *forced* to equal its parent's. Cross-tenant references are
impossible at the database level — even with the service-role key. Verified on
Postgres 16: an insert claiming Org A but pointing at Org B's project is rejected by
the FK; RLS independently hides other tenants' rows (member sees their data,
non-member sees none).

### RLS performance
Policy predicates wrap `auth.uid()` / helper calls in `(select …)` so Postgres
evaluates them once per statement (initplan) rather than per row — this is what keeps
RLS cheap into the thousands of orgs.

> Deliberately **not** using `FORCE ROW LEVEL SECURITY`: it would also subject the
> `SECURITY DEFINER` helpers (which must read `org_members` un-gated) to RLS and
> re-introduce recursion. PostgREST always queries as `authenticated`/`anon`, which
> are bound by RLS regardless; the service role bypasses RLS by design and is used
> server-side only.

### Scale beyond this
If per-request membership lookups ever become the bottleneck, the next step is a
**custom access-token hook** that bakes org memberships/roles into the JWT, so RLS
reads a claim with zero DB round-trip. Deferred — optimized membership-table RLS
handles thousands of orgs comfortably.

## 2. Two clients, one backend — and the offline boundary
Construction sites have poor connectivity, so **field capture is offline-first** (Expo + PowerSync ↔ on-device SQLite). But **finance must never act on stale local data**, so invoices/payments/approvals are **online, server-authoritative**.

| Offline-synced | Online-only |
|---|---|
| site reports, photos/video, progress, GPS check-ins, draft requests | invoices, payments, POP verification, approval decisions, budget edits, Paynow, member/role admin |

## 3. Authorization = isolation (DB) + capability (app)
- **Isolation**: enforced by RLS on `org_id`.
- **Capability**: enforced by `packages/shared/access` (`roles.ts` + `permissions.ts`), shared by web and mobile.
- **Segregation of duties** is encoded in the permission map: `finance` moves money but cannot approve variations/requests; `pm` runs delivery + approvals but cannot move money. Amount-based approval *thresholds* layer on top via approval policies (finance slice).

## 4. Auth is swappable
We start on Supabase Auth (tight RLS integration via `auth.uid()`), but the app depends only on `@datumpro/shared/auth`'s `AuthProvider` interface. Enterprise SSO (WorkOS/Clerk/SAML) becomes a provider swap, not a rewrite.

## 5. Money
Stored and computed as **integer USD cents**. USD-only in v1 (no FX). Format only at display edges (`formatUsd`).

## 6. Industry packs are templates, not forks
Construction / marketing / IT share one project engine; an industry "pack" is preset templates + terminology, never a separate data model.

## Build slices (sequencing)
1. **Foundation** (this scaffold) — monorepo, tenancy + projects schema + RLS, shared domain/access, web shell, auth.
2. **Monitoring** — site reports + media, milestones; mobile offline capture + PowerSync.
3. **Requests & approvals** — request types, approval chains + policies.
4. **Finance** — schema ✅ (budget/BOQ, variations, invoices + lines, payment
   schedule, payments, proof-of-payment, Paynow). Money is integer USD cents; line
   totals are generated columns; cross-tenant references blocked by composite FKs;
   POP enforces verifier ≠ submitter at the DB level (segregation of duties).
   Next: app UI + Paynow integration + Inngest jobs.
5. **Hardening** — notifications (Resend/Africa's Talking), Sentry, CI, reporting.
