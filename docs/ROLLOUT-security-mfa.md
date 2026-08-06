# Rollout — Security hardening, data-layer MFA & compliance

A hand-off for shipping the security batch on branch
`claude/datumpro-ui-details-migration-lj7ltr` to production. Two parts: **what
changed** (context) and **what to deploy** (the checklist you must run — none of
it happens automatically).

> Owner/operator: **Quillstone Capital Private Limited**, 275 Henderson Road,
> Hatfield, Harare · +263 77 618 3229 · allenk@quillstonecapital.com

---

## What changed

### Security assessment fixes (F1–F9)
- **F1** — `next` bumped to `^15.5.22` (clears the Server-Actions DoS and
  disclosure advisories). Code only.
- **F3** — security response headers + a **Content-Security-Policy that is now
  ENFORCED** (was Report-Only). Dev keeps `'unsafe-eval'` + `ws:`; production is
  strict.
- **F4** — the public `avatars` bucket is capped to 5 MB and WebP/JPEG/PNG.
  *(migration)*
- **F5** — `org_domains_update` gains the missing `WITH CHECK`. *(migration)*
- **F8** — cron bearer secret compared in constant time. Code only.
- **F2** — **org-required MFA is now enforced at the data layer.** The four RLS
  membership helpers (`is_org_member`, `org_role`, `is_project_member`,
  `project_role`) require AAL2 when an org has `require_mfa = true`; the app-shell
  layout uses an AAL-independent `mfa_required_pending()` to drive the `/mfa`
  redirect. *(migration — see the staged rollout below, this is the sensitive one)*
- **F6** — the public enterprise-request form is throttled in the RPC (3/hour per
  email, 10/min global) and has a honeypot field. *(migration + app)*
- **F7** — a per-user cap of 10 owned organisations via a BEFORE INSERT trigger.
  *(migration)*
- **F9** — a runnable RLS regression suite (`supabase/tests/rls_security.sql`,
  `pnpm test:rls`) now gated in CI against a real Supabase stack.

### Platform hardening
- **Fail-fast env validation at boot** (`lib/env.server.ts` via
  `instrumentation.register()`): missing `SUPABASE_SERVICE_ROLE_KEY` in production
  now **crashes startup** with a clear message; recommended-but-optional secrets
  warn.
- **Cookie consent + legal pages**: Google Analytics is opt-in (loads only after
  Accept); new `/privacy` and `/terms` pages.

### Pending database migrations (apply in this order)
```
20260101007800_security_hardening.sql        # F4 + F5
20260101007900_mfa_data_layer.sql            # F2
20260101008000_enterprise_request_throttle.sql  # F6
20260101008100_org_creation_cap.sql          # F7
```

---

## What to deploy

### 0 · Pre-flight
- [ ] **Back up the database first.** Confirm Supabase **Point-in-Time Recovery**
      is enabled (Dashboard → Database → Backups), or take a manual snapshot.
- [ ] Merge the branch to `main` (or deploy from the branch in a preview first).
- [ ] Confirm the CI **`DB security (RLS regression)`** job is green on the PR.

### 1 · Environment variables (Vercel project + Supabase)
The app now validates these at boot.

**Required (production boot fails without it):**
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

**Strongly recommended (feature is silently off / warns if unset):**
- [ ] `CRON_SECRET` — **Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
      only when this is set**; without it every `/api/cron/*` job (SLA, digest,
      reminders, progress, orphan-media) is refused by the F8 guard.
- [ ] `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — transactional email (invites,
      resets).
- [ ] `SENTRY_DSN` — server error reporting.

**Also confirm present:**
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `NEXT_PUBLIC_APP_URL`
- [ ] `NEXT_PUBLIC_GA_ID` — Google Analytics id (now **consent-gated**; no id →
      no analytics)
- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` — web
      push (optional)
- [ ] `ADMIN_ADAPTER_SECRET` + `PULSE_URL` — Mission Control / support bridge
      (both or neither)
- [ ] `ENTERPRISE_REQUEST_NOTIFY_EMAIL`, `AUDIT_ALERT_WEBHOOK` — optional

### 2 · Apply database migrations (hosted Supabase)
From a machine linked to the project (`supabase link --project-ref <ref>`):
```bash
supabase db push        # applies the 4 pending migrations in order
```
`db push` is non-destructive (it does not reset data). If you deploy migrations
through CI/CD instead, run that pipeline now.

**Verify (paste into the Supabase SQL editor):**
```sql
-- F4: avatars bucket constrained
select id, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'avatars';         -- expect 5242880 + image types

-- F5: org_domains_update now has a WITH CHECK
select polname, polwithcheck is not null as has_with_check
  from pg_policy where polname = 'org_domains_update';  -- expect has_with_check = t

-- F2: MFA helpers exist
select proname from pg_proc
 where proname in ('session_aal','session_meets_org_mfa','mfa_required_pending')
 order by 1;                                          -- expect all three

-- F2: no org is force-MFA yet, so nothing changes for existing users on deploy
select count(*) filter (where require_mfa) as mfa_orgs from public.organizations;  -- expect 0

-- F7: the cap trigger is attached
select tgname from pg_trigger where tgname = 'organizations_creation_cap';
```

### 3 · Deploy the web app (Vercel)
- [ ] Trigger the deploy (merge to `main` or promote the preview).
- [ ] **CSP is now enforced.** On the first production load, open the browser
      console and watch Sentry for `Content-Security-Policy` violations. If
      something is blocked, the report names the exact directive — add the host to
      the matching list in `apps/web/next.config.mjs` and redeploy. (Verified
      clean locally for the marketing + auth surfaces; watch the authenticated
      app, live GA, and any newly-added third party.)

### 4 · Post-deploy smoke tests
- [ ] Sign in; load the dashboard; create a project.
- [ ] Upload an avatar — a ≤5 MB image works; a non-image / huge file is rejected.
- [ ] Submit the `/enterprise` form once → success; rapid repeats from the same
      email are throttled.
- [ ] `curl -i https://<app>/api/cron/sla` → **401** without the bearer; with
      `Authorization: Bearer $CRON_SECRET` → **200**.
- [ ] Landing page: the cookie banner appears; **GA does not load until you click
      Accept**; `/privacy` and `/terms` render.

---

## 5 · MFA staged rollout (the careful part)

The data-layer gate (F2) is live in the database after step 2, **but no
organisation has `require_mfa` enabled** (default `false`), so **nothing changes
for any existing user** until an admin turns it on. Roll it out deliberately.

### Stage A — internal verification on ONE test org
1. As a **test user**, enrol a TOTP factor (Account → security, or visit `/mfa`).
2. As that org's **admin**, enable **“Require 2FA”** in Org settings.
3. Sign out and sign back in with **password only (AAL1)**:
   - [ ] You are redirected to `/mfa` and cannot reach org data. Confirm the API
         is closed too — an AAL1 session should read **zero** rows:
     ```sql
     -- Run as the test user's session (e.g. via the app's network calls) — the
     -- dashboard should show nothing until 2FA is completed.
     ```
   - [ ] Complete the TOTP challenge (**AAL2**) → full access returns.
4. [ ] A **second user** in that org who has no factor is forced to enrol before
       they can use it.
5. [ ] A **different org WITHOUT** `require_mfa` still works normally at AAL1
       (no regression for everyone else).

> This mirrors `supabase/tests/rls_security.sql`, which already asserts all of the
> above in CI. Stage A confirms it end-to-end against hosted Auth (real `aal`
> claims) with a real enrolled authenticator.

### Stage B — pilot
- [ ] Enable `require_mfa` on 1–2 friendly real orgs. Watch for lockouts and
      support tickets for a few days.

### Stage C — general availability
- [ ] Document the toggle for admins and communicate that enabling it forces all
      members to enrol a second factor.

### Lockout & recovery (document for support)
A user in a `require_mfa` org who loses their authenticator is locked out **by
design**. To recover, either:
- an admin/support **removes that user's MFA factor** (Supabase Dashboard → Auth →
  the user → delete factor), so they can re-enrol on next sign-in; or
- temporarily **disable `require_mfa`** for the org.

### Rollback
- **Fast mitigation:** disable `require_mfa` on the affected org — access returns
  to AAL1 immediately; no redeploy needed. The migration is safe to leave in place
  (the helpers are inert while `require_mfa = false`).
- **Web rollback:** redeploy the previous Vercel build.
- **Full DB rollback** is rarely needed; prefer fixing forward. If you must revert
  the F2 helper changes, restore the prior bodies of `is_org_member`, `org_role`,
  `is_project_member`, `project_role` from `git show` of the pre-`007900` versions
  in a new migration — do **not** hand-edit production functions.

---

## After rollout
- [ ] Mark **`DB security (RLS regression)`** a required status check on `main`
      (GitHub → Settings → Branches) so the invariants stay gated.
- [ ] Fill the remaining `[company registration number]` in `apps/web/lib/legal.ts`
      and have a lawyer review `/privacy` and `/terms` before treating them as final.
