# Production-Readiness Audit — Verification & Remediation Register

> Audit received 2026-09-05; every claim was re-verified against the code and the
> live project before acting (verdicts below). Fixed items landed in PR
> `fix/prod-audit-batch`. Open items carry an owner/decision needed.

## Verdicts on audit claims

| Claim | Verdict | Notes |
|---|---|---|
| Web+mobile duplicate `lib/data` layers, no shared DB types | **Verified** | Architectural; see open items |
| Docs claim PowerSync offline-first; none implemented | **Verified (doc stale)** | Doc corrected — both clients are online-only; offline is roadmap |
| `validateServerEnv` requires only service-role key in prod | **Verified** | Fixed — see below |
| Unused `hasPlan`/`planApproved` props (mobile task-actions) | **Verified** | Fixed |
| Admin analytics/logs/flags/legal return simulated data | **Verified** | analytics/logs/flags deleted; legal kept (see open) |
| "Broken invitation endpoint" | **REFUTED** | `/api/admin/invitations/create` + `/invite/[token]` work end-to-end (token → real email → `accept_org_invitation()` inserts membership) |
| Bid workspace hard-codes USD | **Verified** | Fixed — tender carries `boqs.currency` |
| Next ESLint plugin "not detected" build warning | **Verified** | Fixed (flat-config registration Next's detector recognises) |
| Middleware on ~every request + SSR client + rate limiter | **Verified** | Accepted for current tenant count; measure before scale-up (open) |
| Unbounded selects + in-memory grouping (jobs, member list) | **Verified** | Job queries capped; full pagination deferred (open) |
| Unbounded `Promise.all` push fan-out in both Edge Functions | **Verified** | Fixed — batches of 8 |
| Notification bell polls every 30 s alongside realtime | **Verified** | Fixed — event-driven + slow safety poll |
| No size policy on `project-media` / `chat-media` buckets | **Verified** (live DB check) | Fixed — 50 MB / 25 MB + client-side checks |
| `pnpm audit --prod`: 33 vulns (22 high, 11 moderate) | **Verified** | Overrides applied; residuals documented below |
| `test:rls` fails on an existing local stack | **Expected behaviour** | The suite requires a clean DB; CI runs it on a fresh stack every PR and is green. Noted in the suite header |

## Fixed in `fix/prod-audit-batch`

- **Edge Functions** (`notification-push`, `chat-push`): fan-out now runs in
  bounded batches of 8; both redeployed.
- **Buckets** (migration `20260905100000`): `project-media` capped at 50 MB,
  `chat-media` at 25 MB; matching client-side checks in web + mobile uploaders.
- **Env gate**: production now hard-requires `SUPABASE_SERVICE_ROLE_KEY`,
  `CRON_SECRET`, `RESEND_API_KEY` (all confirmed present in the live Vercel
  project before making them fatal). `SENTRY_DSN` remains a warning until an
  error-reporting decision is made.
- **Deleted simulated control-plane endpoints**: `/api/admin/analytics`,
  `/api/admin/logs`, `/api/admin/flags` (fabricated/in-memory data, no callers).
- **Docs**: ARCHITECTURE.md no longer claims offline-first mobile.
- **Mobile**: unused task-action props removed.
- **Tender workspace**: displays the tender's real currency.
- **Jobs**: weekly-digest / SLA / snapshot queries carry explicit row caps with
  a warning when hit.
- **Dependencies**: pnpm overrides pin patched versions of brace-expansion,
  browserslist, js-yaml, nanoid, postcss, sharp, tar@7, @xmldom/xmldom, undici@6,
  uuid@11, decode-uri-component.

## Open items (decision or larger work needed)

| # | Item | Size | Needs |
|---|---|---|---|
| 1 | **Durable rate limiting** — no Upstash configured; prod limiter is in-memory per-instance | S | An Upstash Redis (Vercel Marketplace) + 2 env vars; code already supports it |
| 2 | **Error reporting** — no `SENTRY_DSN` in prod | S | Decision: Sentry account (or alternative), then flip env-gate to required |
| 3 | **Shared DB type/API contract + client parity** — regenerate supabase types into `packages/shared`, consume from both `lib/data` layers; parity tests for invite/task-transition/tender/payment/upload | L | Dedicated workstream; biggest structural item |
| 4 | **Mobile secure storage** — sessions/refresh tokens in AsyncStorage, move to SecureStore (needs an EAS rebuild; known deferred item) | M | Schedule with next mobile batch |
| 5 | **Admin legal adapter** — kept, but state is in-memory (lost on restart); persist or fold into the DB | S/M | Product call: is the Pulse console still planned? |
| 6 | **Pagination for member/admin lists** | M | Fine at current tenant size; needed before large orgs |
| 7 | **Middleware cost** — measure cold start/p95 with durable rate limiting on; consider narrowing the matcher | M | After item 1 |
| 8 | **Backups/restore drill, post-deploy synthetic probes, load test** | M | Ops session: Supabase PITR check + a scripted probe + k6/artillery baseline |
| 9 | **Residual dependency vulns (33 → 3)** — `image-size` (2 highs, NO patched release exists) and `uuid@<11.1.1` (1 moderate), both only inside the Expo/metro build toolchain, not runtime; forcing cross-major bumps there risks EAS builds | S | Re-audit on next Expo SDK upgrade |
| 10 | **Bootstrap/clean-DB parity + SBOM + release checklist items** | M | Track against the audit's release-acceptance list |
