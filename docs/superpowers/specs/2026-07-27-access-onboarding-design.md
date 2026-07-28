# DatumPro — Access & Onboarding Design

**Date:** 2026-07-27
**Status:** Approved — ready for implementation planning
**Author:** Allen Karumbidza (with Claude)

## 1. Purpose & Context

DatumPro is a multi-tenant project/finance platform sold to **corporates, construction companies, NGOs, and government**. Its security foundation is already strong (Supabase Auth, Row-Level Security on `org_id`, a mature org/project role model). The weakness is **trust-signalling and enterprise-readiness at onboarding**: organization registration captures only a name, invite emails are never sent, and there is no MFA, audit trail, or trust surface.

This spec defines the end-to-end access and onboarding experience — how people log in and how organizations register — optimized to win trust with the four target buyer segments.

### Decisions locked during brainstorming
- **Go-to-market:** Hybrid — self-serve lane + a government/enterprise "request access" lane.
- **Self-serve verification:** Work email + a lightweight company profile on record (no hard verification).
- **Enterprise trust priorities:** MFA enforcement, audit log, data-residency messaging. **SSO/SAML deferred** (heaviest, Supabase-tier-gated).
- **Scope:** Spec the entire flow as one blueprint with clear internal phases; build order decided at planning.

### Two baked-in judgment calls
- **Work-email is a soft nudge, not a gate.** On org creation, a personal-domain email (gmail, outlook, …) shows a non-blocking warning encouraging a work address, but the org is always created. This protects the many legitimate Gmail-based SMEs in the target market (see Reconciliation §0). Invited members are never nudged.
- **Enterprise approval is manual** (DatumPro provisions), not automated — appropriate for the stage and for government procurement.

## 0. Reconciliation with the existing identity/access roadmap

This spec was cross-checked against the repo's existing roadmap: `handover-a-identity-access-blockers.md`, `handover-b-tasks-alerts-tendering.md`, `datumpro-snag-spec-02.md`, and `docs/FUNCTIONAL_SPEC.md`.

- **Scope boundary — this spec vs Handover A.** This onboarding work operates on the **`organizations`** table (company profile) and the **public login surface**. Handover A / snag-spec §1 own the invitee's **personal profile setup** (`profiles.username`, `avatar_url`, national-ID handling) and the richer **`invitations`** table (hashed `token_hash`, `phone`/WhatsApp fallback, `expires_at`, `intended_party`, resend rate-limiting). **This onboarding work must not modify invitations or personal profiles** — those changes belong to Handover A. Two different "setup" flows: the owner's *company* setup (here) and each invitee's *personal* setup (there).
- **Market context.** DatumPro targets Zimbabwe / Southern Africa. Two consequences carried into this design: (1) **email is unreliable for site contractors — WhatsApp/phone is the real channel** (snag-spec §1.2 gives invitations a `phone` column), which is why the work-email nudge applies to org creation only, never to invited members; (2) national ID numbers are identity-theft-sensitive and must never be rendered — not touched here, but noted so the company profile never conflates registration number with personal ID.
- **Repo pattern wins.** Per the handover working rules, established repo patterns override the spec where they differ; this plan follows existing migration, server-action, and UI conventions.
- **Dependency to flag, not build:** invite delivery is email-only today (Resend). For site-contractor adoption, a WhatsApp/SMS channel may be needed later — an open question in snag-spec §5, owned by the notification work, out of scope here.

## 2. Current State (what exists today)

| Area | Status |
|------|--------|
| Auth (Google, LinkedIn OIDC, email+password, magic link) | ✅ Working — `apps/web/app/sign-in/page.tsx`, `apps/web/app/auth/callback/route.ts` |
| Multi-tenant isolation via RLS + composite `org_id` keys | ✅ Strong |
| Org model (`organizations`, `org_members`, `org_invitations`, `profiles`) | ✅ `supabase/migrations/20260101*` |
| Role model (7 org roles, 4 project roles, 8 member types) | ✅ `packages/shared/src/access/` |
| Org creation (`/orgs/new` → `createOrg()`) | ⚠️ Single field (name only) |
| Invite → accept flow | ✅ Logic exists — `apps/web/app/invite/[token]/` |
| **Invite email delivery** | ✅ **Already wired** — Resend via `apps/web/lib/email/resend.ts`; `inviteMember`/`resendInvitation` send accept links (`apps/web/app/(app)/org/members/actions.ts`). Env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. |
| Email verification | ⚠️ Not enforced |
| MFA / 2FA | ❌ Not surfaced |
| Audit log | ❌ Absent |
| Trust / security surface | ❌ Absent |
| Enterprise / SSO lane | ❌ Absent |

## 3. Target Experience

### 3.1 Public surface (trust-forward)
- Rebuild `/sign-in`; add dedicated `/sign-up`; add `/security` trust page (data-isolation statement, where-your-data-lives, residency commitment, security practices).
- Login/signup lead with trust signals and present **two doors**: **"Start free"** (self-serve) and **"For government & enterprise"** → `/enterprise`.
- Retain all four existing auth methods.

### 3.2 Self-serve lane
1. Sign up with any email or Google/LinkedIn. On **org creation**, a personal-domain email shows a **non-blocking work-email nudge** (never blocks; never shown to invited members).
2. **Email verification ON** (Supabase confirmation).
3. **Setup wizard** replaces the one-field `/orgs/new`:
   - **Company profile** — legal name, country, sector, registration number (optional), slug.
   - **Security** — enable MFA / optionally require 2FA for members.
   - **Invite team** — emails + roles (emails actually sent).
   - **First project** (optional).
   - Completion tracked via `organizations.onboarding_completed_at`.
4. Land in dashboard with RLS + audit logging active.

### 3.3 Government / enterprise lane
1. `/enterprise` **request-access form** — org name, country, buyer type, contact, team size, needs (SSO? residency?).
2. Creates a **pending** org and notifies DatumPro (internal email + admin inbox).
3. DatumPro reviews and **provisions/approves** → owner receives an invite.
4. Owner completes the same setup wizard. **SSO/SAML plugs in here later.**

## 4. Data Model (new Supabase migrations)

All new tables/columns follow existing conventions: RLS enabled, `org_id` scoping, SECURITY DEFINER helpers with `search_path = ''`, initplan-wrapped policies.

### 4.1 `organizations` — add columns
- `legal_name text`
- `country text`
- `sector text`
- `registration_number text` (nullable)
- `status org_status` — new enum `('active','pending','suspended')`, default `'active'`
- `created_via org_created_via` — new enum `('self_serve','enterprise_request')`, default `'self_serve'`
- `require_mfa boolean not null default false`
- `data_region text` (nullable; documented commitment, infra later)
- `onboarding_completed_at timestamptz` (nullable)

### 4.2 `enterprise_requests` (new)
- `id uuid pk`, `org_name text`, `country text`, `buyer_type text`, `contact_name text`, `contact_email text`, `team_size text`, `needs jsonb`, `status text default 'pending'` (`pending`/`approved`/`rejected`), `created_at`, `reviewed_by uuid`, `reviewed_at timestamptz`, `created_org_id uuid` (nullable, set on approval).
- RLS: no public read; writes via a SECURITY DEFINER RPC from the public form; admin (DatumPro) access via service-role/admin API.

### 4.3 `audit_log` (new)
- `id uuid pk`, `org_id uuid`, `actor_user_id uuid`, `action text`, `entity_type text`, `entity_id uuid` (nullable), `metadata jsonb`, `created_at timestamptz default now()`.
- RLS: owners/admins read their own org's log (`is_org_admin(org_id)`); inserts via server-side helper (service-role or SECURITY DEFINER).
- Index: `(org_id, created_at desc)`.

### 4.4 `org_domains` (Phase 4 stub)
- `id`, `org_id`, `domain text`, `verified_at timestamptz`, `verification_token text`. Defined but not wired until Phase 4 (domain verification + auto-join).

## 5. Email Delivery (the blocker)

- Add a transactional email sender — **Resend** recommended (simple API, good deliverability).
- Env: `RESEND_API_KEY`, `EMAIL_FROM` (validated in `apps/web/lib/env.ts`).
- **Invite send:** app-side, immediately after an `org_invitations` insert in the invite server action — email links to `/invite/{token}?email={email}`.
- **Enterprise notification:** on `enterprise_requests` insert, email DatumPro's internal address.
- Wrap send in a small `lib/email/` module so magic-link/confirmation styling stays consistent and the provider is swappable.
- Failures are logged and surfaced (invite row still created; resend affordance in the members UI).

## 6. Cross-cutting Capabilities

### 6.1 MFA / 2FA
- TOTP enrollment UI in account settings (Supabase MFA API).
- Org setting `require_mfa`; when true, the app shell (`apps/web/app/(app)/layout.tsx`) redirects members without an enrolled factor to an enrollment step before app access.

### 6.2 Audit log
- `logAudit(orgId, action, entityType, entityId?, metadata?)` helper in `apps/web/lib/audit.ts`.
- Called from sensitive server actions: org create, invite create/accept/revoke, role/member-type change, and existing money actions (approvals, payments, POP).
- Owner/admin-only `/org/audit` view with filters (actor, action, date).

### 6.3 Trust surface
- `/security` page: data-isolation statement, data-residency commitment, security practices, contact for security questions. Linked from login/signup footer.

## 7. Access Control Notes
- **Work-email nudge:** personal-domain blocklist (gmail, yahoo, outlook.com, hotmail, icloud, …) used only to render a **non-blocking warning** on the org-creation screen. The org is always created regardless. Invited-member and invite-accept paths are unaffected and show no nudge.
- RLS remains the true security boundary; new tables get policies consistent with existing helpers (`is_org_member`, `is_org_admin`, `is_org_staff`).
- App derives UI from the shared permission map; no new hard-coded route guards beyond MFA enforcement.

## 8. Phasing (build order finalized in the plan)

- **Phase 1 — Trust spine:** email delivery (Resend) · email verification ON · work-email gate · setup wizard + company-profile columns · trust-forward `/sign-in` + `/sign-up` + `/security`.
- **Phase 2 — Enterprise trust:** MFA enrollment + org enforcement · `audit_log` table + `logAudit()` wiring + `/org/audit` view.
- **Phase 3 — Enterprise lane:** `/enterprise` request form · `enterprise_requests` table + notification · `org.status` (pending/suspended) + admin provisioning · data-residency page content.
- **Phase 4 — Later:** SSO/SAML · `org_domains` domain verification + auto-join.

## 9. Out of Scope (this effort)
- Billing/plans modelling.
- SSO/SAML implementation (designed-for, built in Phase 4).
- Physical multi-region data-residency infrastructure (statement/commitment only for now).
- Personal API keys.

## 10. Success Criteria
- A new company can self-serve: sign up with a work email, verify, complete the setup wizard, invite teammates, and have those teammates **receive and accept email invites** — end to end, no manual steps.
- A government/enterprise buyer can submit a request that reaches DatumPro and be provisioned into the same wizard.
- Admins can require MFA and review an audit log of sensitive actions.
- The login/signup experience visibly communicates trust (isolation, residency, security) to a first-time corporate/government visitor.

## 11. Key Files (reference)
| Concern | Path |
|---------|------|
| Login | `apps/web/app/sign-in/page.tsx` |
| Auth callback | `apps/web/app/auth/callback/route.ts` |
| Org creation | `apps/web/app/orgs/new/page.tsx`, `apps/web/app/orgs/actions.ts` |
| Invite | `apps/web/app/invite/[token]/{page,actions}.tsx` |
| App shell (MFA gate) | `apps/web/app/(app)/layout.tsx` |
| Env validation | `apps/web/lib/env.ts` |
| Roles/permissions | `packages/shared/src/access/` |
| Migrations | `supabase/migrations/` |
