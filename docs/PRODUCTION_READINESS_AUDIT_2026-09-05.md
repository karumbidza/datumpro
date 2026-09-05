# DatumPro production-readiness audit

**Audit date:** 2026-09-05  
**Scope:** Web (`apps/web`), mobile (`apps/mobile`), shared package, Supabase
migrations/functions, CI/deployment configuration, dependency lockfile, and
the running local Supabase test stack.  
**Method:** source review, route and privilege-path tracing, migration/bootstrp
comparison, build/type/lint/test execution, the supplied RLS suite, and `pnpm
audit --prod`. This is an evidence-led audit; deployment-console settings and
production runtime telemetry were not available and are explicitly called out
as verification work rather than inferred defects.

## Release decision

**Do not release using the documented `bootstrap.sql` path.** It is materially
stale, despite `DEPLOY.md` saying it is a self-contained snapshot that converges
with `supabase db push`. Use a clean database migration replay only after it
passes the database suite; regenerate or remove the bootstrap path before any
production deployment.

Before a production release, resolve every **P0** and **P1** item below, then
repeat the clean-db and API tests in the acceptance checklist.

## Executive summary

| Priority | Count | Meaning |
| --- | ---: | --- |
| P0 | 1 | Release-blocking deployment integrity failure |
| P1 | 5 | Material security/data-integrity/production-readiness risk |
| P2 | 7 | Important hardening, correctness, performance, or operability debt |
| P3 | 4 | Maintainability and cleanup items |

The repository has several solid foundations: RLS is extensively designed,
`SECURITY DEFINER` functions generally pin their search path, CSP/HSTS and other
web headers are configured, server-only service-role construction is used, and
the project has a substantial SQL security regression suite. The issues below
are not an absence of intent; they are mostly drift and incomplete control-plane
features that have accumulated around it.

## Findings

### P0 — Bootstrap deployment is dangerously stale

**Evidence**

- `DEPLOY.md` §1 tells operators to run `supabase/bootstrap.sql` and states it
  is a snapshot of *every* migration that converges with `supabase db push`.
- There are **152** migration files. A direct filename comparison found
  **135 missing from the bootstrap file**, beginning with
  `20260101001700_payment_claims.sql` and including all 2026 hardening,
  staff/PM-scoping, notification-push, and HSE migrations.
- The bootstrap tail stops in the contractor-document portion of the early
  schema. It does not contain `is_project_pm_for_boq`, which is introduced by
  `20260904120000_pm_project_scoped.sql`.

**Impact**

A new production database deployed by the documented path will have an
incomplete and older authorization model. The current applications can then
fail at runtime against missing tables/functions/columns, while later RLS and
workflow protections are absent. This is a production data and access-control
blocker, not documentation-only drift.

**Required remediation**

1. Make `supabase db push` the sole supported deployment mechanism, or generate
   `bootstrap.sql` deterministically from the exact migration chain in CI.
2. Add a CI check that fails if the snapshot does not represent every migration
   (prefer a clean database replay plus schema-diff check over filename matching).
3. Add a production preflight that records the applied migration history and
   refuses application rollout when it is behind the release commit.

### P1 — Mobile refresh tokens are persisted in unencrypted AsyncStorage

**Evidence**

- `apps/mobile/lib/supabase.ts` configures Supabase Auth with
  `@react-native-async-storage/async-storage`.
- `apps/mobile/lib/accounts.ts` additionally stores a multi-account registry,
  including each `refreshToken`, as JSON under `dp_accounts`.
- No `expo-secure-store` / `SecureStore` usage exists in the mobile app.

**Impact**

Refresh tokens survive in app-readable storage and can be extracted from a
compromised/rooted device, insecure backup, or local-device forensic capture.
The custom registry multiplies the exposure to every remembered account.

**Required remediation**

Use OS-backed secure storage for Supabase sessions and the multi-account refresh
token registry. Migrate existing entries once, erase the AsyncStorage values,
and define a device-compromise/session-revocation response procedure. Test sign
in, refresh, account switching, and sign out on both platforms.

### P1 — Any active organisation member can send phishing links through notifications

**Evidence**

- `public.notify(...)` in
  `supabase/migrations/20260101003100_notifications_and_decline_cleanup.sql`
  permits an active member to insert a notification for any member in the same
  organisation and accepts an unrestricted `p_link`.
- `supabase/functions/notification-push/index.ts` preserves any `http:` or
  `https:` link in `absoluteUrl`.
- `apps/web/public/sw.js` passes the received URL to `client.navigate(url)` or
  `clients.openWindow(url)` after a push click.
- The web toast path calls `router.push(toast.link)`.

**Impact**

An ordinary member can create a trusted DatumPro push/toast pointing at an
attacker-controlled website for another member in the same organisation. This
is a credible internal-phishing vector and should not be treated as a harmless
notification feature.

**Required remediation**

Constrain notification links at the database boundary to relative, allowlisted
application routes (or derive them only from typed entity IDs). Reject absolute
URLs in the Edge Function and service worker as defence in depth. Narrow or
replace the general-purpose `notify` RPC with typed, server-side notification
commands; add a regression test proving an arbitrary member cannot enqueue an
external link.

### P1 — Public intake bypasses the protected database contract and has no durable abuse control

**Evidence**

- `apps/web/app/api/request-access/route.ts` is publicly callable and inserts
  directly with the service-role client, bypassing RLS and the existing
  `submit_enterprise_request` SECURITY DEFINER RPC used by the landing and
  enterprise forms.
- The endpoint performs only required-field checks; it does not enforce typed
  length, email, enum, or payload-size validation.
- Middleware uses a per-IP rate limiter. Without Upstash it intentionally falls
  back to per-instance in-memory state (`apps/web/lib/rate-limit.ts`), and
  production environment validation only warns about optional configuration.

**Impact**

Automated requests can create spam/PII records and consume service-role database
capacity. In a multi-instance/serverless deployment the fallback is readily
bypassed. Bypassing the canonical RPC also creates two inconsistent validation
and throttling policies for the same data.

**Required remediation**

Route all public submissions through one schema-validated command/RPC, impose
server-side body and field limits, and make a durable edge/WAF/Redis rate limit a
production requirement. Return generic errors rather than raw database errors.
Add abuse tests for distributed-rate-limit fallback and malformed/oversized
inputs.

### P1 — Admin invitation endpoint creates links that the application cannot honour

**Evidence**

- `apps/web/app/api/admin/invitations/create/route.ts` generates a random token
  and an `expiresAt` timestamp, but neither is inserted into
  `org_invitations` (nor any other invitation table).
- `/invite/[token]` looks up its token through `getInvitationPreview()` and
  accepts it with `accept_org_invitation`; both rely on a persisted invitation.
- Updating an optional `enterprise_requests` row only changes its status.

**Impact**

The privileged control-plane endpoint emails and returns an activation URL that
will be reported as invalid. Its stated expiry is unenforced. This creates a
broken onboarding path and operator confusion at the end of production.

**Required remediation**

Either remove this endpoint until it is designed, or create an atomic
database-backed invite workflow with a hashed token, expiry, single-use status,
recipient binding, audit record, resend/revoke behavior, and an end-to-end test
that follows the emailed link to a created/accepted membership.

### P1 — Dependency audit reports 33 production dependency vulnerabilities

**Evidence**

`pnpm audit --prod --audit-level=low` reported **33 vulnerabilities: 22 high,
11 moderate**. Examples include:

- `apps/web > next@15.5.22 > sharp@0.34.5`: high-severity libvips issues;
  advisory states `sharp >=0.35.0` is patched.
- Expo/React Native dependency paths include high-severity `brace-expansion`
  and `postcss` findings and moderate `undici`, `decode-uri-component`, and
  `@xmldom/xmldom` findings.

**Impact**

Some paths are build/development transitive dependencies, but this audit was run
with `--prod`, so they must be triaged rather than waived wholesale. The web
`sharp` path is particularly relevant to a Next deployment.

**Required remediation**

Upgrade Next/Expo to patched compatible releases first, then apply narrowly
scoped package-manager overrides only where upstream compatibility is verified.
Keep an audited SBOM and add a CI vulnerability threshold with documented
exceptions and expiry dates.

### P2 — Database security regression is not currently green on the existing local stack

**Evidence**

- `pnpm test:rls` connected to the real local Supabase/Postgres stack and
  progressed through extensive tenant, MFA, tender, and workflow checks.
- It failed at `supabase/tests/rls_security.sql:916`:
  `role-split: staff is project-scoped — CANNOT read the BOQ library`.
- The local catalogue lacks `public.is_project_pm_for_boq(uuid)`, showing the
  existing local database has not applied the current migrations. The failure is
  therefore verified, but it cannot yet distinguish a clean-schema regression
  from stale local schema state.
- A clean `supabase db reset` was requested to establish that distinction but
  was not permitted because it irreversibly clears the existing local database.

**Required remediation**

Run the suite against a disposable clean database/CI service, not an
untracked developer database. The required acceptance signal is: fresh replay of
all migrations, then the entire RLS suite passes. Preserve this failed result
until that evidence exists; do not mark database hardening complete.

### P2 — Control-plane APIs return simulated, in-memory, or non-authoritative state

**Evidence**

- `apps/web/app/api/admin/analytics/route.ts` synthesizes `weeklyVisits`, DAU,
  MAU, and feature counts from row totals.
- `apps/web/app/api/admin/logs/route.ts` returns static `sampleLogs`.
- `apps/web/app/api/admin/flags/route.ts` changes a module-level `flagState`;
  the flags do not drive application behavior and are lost on a cold start or
  across instances.
- `apps/web/app/api/admin/legal/route.ts` changes module-level `legalState`,
  while public legal pages read the static `LEGAL` configuration.

**Impact**

Operations tooling can present fabricated telemetry and claim changes that do
not persist or affect the product. This is a classic production “vibe-coded”
control-plane failure: a plausible interface without an authoritative backend.

**Required remediation**

Remove endpoints that are not ready, or back each with a durable model,
authorization/audit trail, metrics definition, and integration tests. Label
derived estimates explicitly until measured events exist.

### P2 — Upload surface lacks consistent server-enforced file limits

**Evidence**

- `project-media` and `chat-media` buckets are created without bucket file-size
  limits or MIME allowlists. Multiple web/mobile upload paths accept client
  supplied MIME values and file extensions.
- The avatar and organisation-logo buckets do have limits/allowlists, proving
  the platform supports the control.

**Impact**

Authenticated users can store arbitrarily large or unexpected content in the
media buckets, driving cost and exposing unsafe content to downstream preview,
export, or malware-scanning paths. Client `accept=` attributes are not a
security boundary.

**Required remediation**

Set explicit bucket limits and MIME allowlists by use case; validate file magic
bytes and dimensions/media duration in a trusted upload pipeline; quarantine or
scan files before making them available. Define retention/quota policies per
organisation and test that rejected media cannot leave orphan objects.

### P2 — Weekly unsubscribe tokens never expire and reuse the cron secret

**Evidence**

- `apps/web/lib/jobs/digest-token.ts` signs only `userId:orgId` with
  `CRON_SECRET`; it contains no expiry, nonce, key identifier, or audience.
- The endpoint copy says a token may be “invalid or expired”, but no expiry is
  implemented.

**Impact**

Old unsubscribe links remain valid indefinitely. Coupling public-link token
signing to the cron authentication secret increases blast radius and complicates
rotation.

**Required remediation**

Use a dedicated digest-token key, issue short-lived tokens with `iat`/`exp` and
key ID, and rotate gracefully. Keep one-click unsubscribe functional while
making token lifetime an explicit privacy decision.

### P2 — Privileged admin plane has a single shared bearer secret and weak input contracts

**Evidence**

- `/api/admin/*` trusts only `ADMIN_ADAPTER_SECRET`; it has no caller identity,
  request signature, replay protection, per-operation scope, IP policy, or
  immutable audit log at the route boundary.
- Several endpoints parse `unknown` JSON by type assertion rather than a runtime
  schema. Raw database errors are returned by multiple routes.

**Impact**

Leakage of one long-lived shared secret exposes cross-tenant roster data and
member enable/disable/role change operations. Error responses can reveal
internal database detail to the adapter caller.

**Required remediation**

Adopt a short-lived signed service identity (issuer/audience/expiry), separate
scopes for read and mutation endpoints, runtime schemas, structured audit logs
with request ID and actor, generic external errors, and secret rotation.

### P2 — Cross-platform business/data layers are duplicated and vulnerable to drift

**Evidence**

- Web and mobile each implement large, separate `lib/data` layers over the same
  Supabase schema and use their own input shaping and error handling.
- The shared package centralises some validation/domain code but not the data
  commands or generated database types.
- The production architecture document still says mobile field capture is
  PowerSync/SQLite offline-first, but the committed mobile data layer directly
  calls Supabase; no PowerSync code/configuration was found.

**Impact**

Authorization-sensitive behavior, validation, storage paths, and feature
support can diverge across clients. The documented offline guarantee is not
demonstrably implemented, making field-operation expectations unsafe.

**Required remediation**

Choose and document the actual offline contract. Generate and consume a shared
database type/API contract; centralise command validation; keep database RPCs as
the source of workflow authority. Add parity tests for web and mobile critical
flows (invite, task transition, tender, payment request, upload).

### P2 — Observability and recovery gates are not enforced for production

**Evidence**

- `validateServerEnv()` requires only `SUPABASE_SERVICE_ROLE_KEY` in production;
  Sentry, transactional mail, cron secret, and durable rate limiting are warnings
  or optional.
- `DEPLOY.md` includes manual verification steps, but CI does not exercise web
  route authorization, public endpoint abuse behavior, Edge Functions, mobile,
  or production configuration.

**Required remediation**

Make the minimum production control set explicit and fail deployment when it is
absent: durable rate limiting/WAF, error reporting, cron auth, transactional
email for invite-enabled releases, backup/restore verification, and alerting for
failed scheduled jobs. Add synthetic health/auth probes after deployment.

### P3 — Confirmed cleanup and engineering-quality items

1. **Unused props:** lint reports `hasPlan` and `planApproved` unused in
   `apps/mobile/components/task-actions.tsx` (lines 17–18). Remove them or wire
   them to behavior.
2. **Orphan/dead control-plane capabilities:** the analytics, logs, flags, legal
   and broken invitation endpoints should be deleted or completed; leaving them
   deployed expands the privileged surface without product value.
3. **Currency TODO in tender workspace:**
   `apps/web/app/tender/[token]/bid-workspace.tsx` defaults display to USD rather
   than carrying tender currency. This is a commercial correctness risk when
   multi-currency is introduced.
4. **Build warning:** Next reports that the Next.js ESLint plugin was not
   detected in the ESLint configuration. The build succeeds, but this leaves
   framework-specific lint coverage uncertain.

## Performance review

No load-test traces or production telemetry were available, so throughput and
latency claims would be guesses. The following source-backed risks should be
tested before scale-up:

- Edge middleware runs on nearly every non-static request, creates a Supabase
  SSR client, and calls the rate limiter; build output reports a **119 kB**
  middleware bundle. Measure cold start and p95 latency with durable rate-limit
  network calls enabled.
- Several admin and job paths request entire table sets before grouping in
  application memory (for example org/member listing). Add pagination,
  bounded queries, indexes confirmed by `EXPLAIN ANALYZE`, and load tests at the
  expected tenant size.
- Notification fan-out uses unbounded `Promise.all` over device targets in both
  Edge Functions. A large organisation can exceed function duration or an
  upstream push-service limit. Use batches, concurrency limits, retry queues,
  idempotency, and per-recipient delivery metrics.
- Client notification counts poll every 30 seconds while realtime is already
  present. Quantify this database load and prefer event-driven invalidation where
  it reduces query volume.
- Uploads have no enforced size policy on two primary buckets; this is both a
  security and cost/performance risk.

## What passed

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed with 2 warnings (unused mobile props) |
| `pnpm typecheck` | Passed for web, mobile, shared |
| `pnpm test` | Passed: 56 shared-package tests |
| `pnpm build` | Passed: production Next build completed |
| `pnpm test:rls` | **Failed** on existing local stack; see P2 clean-db requirement |
| `pnpm audit --prod --audit-level=low` | **Failed:** 33 vulnerabilities (22 high, 11 moderate) |

## Release acceptance checklist

1. [ ] Replace/regenerate the bootstrap procedure and prove a clean database has
       the same schema as the migration chain.
2. [ ] Run clean-db migration replay plus the whole RLS suite successfully.
3. [ ] Remediate/triage every production dependency vulnerability, including
       Next/sharp, with recorded versions and an SBOM.
4. [ ] Move mobile sessions and remembered refresh tokens to secure storage and
       test migration/logout/account switching.
5. [ ] Close the notification external-link primitive with DB and Edge-function
       tests.
6. [ ] Consolidate public request access into the validated/throttled path and
       prove a durable distributed rate limit.
7. [ ] Remove or complete the broken admin invitation and simulated control-plane
       endpoints.
8. [ ] Enforce media limits/scanning/retention and exercise upload failure cleanup.
9. [ ] Confirm Supabase Auth redirect URLs, production secrets, MFA policy,
       storage buckets/policies, Edge Function webhook secrets, Vercel cron,
       backups, restore drill, and alert destinations in the production consoles.
10. [ ] Run authenticated API integration tests, mobile smoke tests, and a
        realistic load test; capture p95 latency/error rate/budget results.

## Suggested remediation sequence

1. **Stop unsafe deployment paths:** P0 bootstrap issue and clean-db test gate.
2. **Close token/link/session risks:** mobile secure storage, notification-link
   restriction, admin identity tightening.
3. **Harden public ingress and uploads:** durable rate limits, schemas, media
   controls, dependency upgrades.
4. **Remove false capabilities:** simulated admin APIs and broken invitations.
5. **Make operations measurable:** real telemetry, queue/fan-out controls,
   post-deploy probes, backup restore evidence, and performance baselines.

