# Org member-management center + approval matrix

**Date:** 2026-08-28
**Status:** Approved (design)
**Builds on:** `2026-08-26-recent-activity-redesign-design.md` era; the tabbed `/org`
settings shipped in PR #23.

## Problem

The `/org` settings page now has tabs, but org administration is scattered: member
management lives on a separate `/org/members` page, a persistent "Manage" strip
repeats across every tab, the Finance link duplicates its own nav item, contractor
compliance docs sit on yet another page, and the approval policy is a single
org-wide "second approver" dropdown that hides the approval engine's real
capability. We want member management to be the **center** of org admin, and the
approval configuration to express "what needs two sign-offs, by which roles, above
what amount."

## Key finding (why this is mostly reorg)

An audit established that most requested capability already exists:

- **Member management** already supports: assign role/member_type
  (`updateOrgMemberRole`), **block/reactivate** (`deactivateOrgMember` /
  `reactivateOrgMember` → `org_members.status` `active`/`disabled`), remove, invite,
  resend/revoke invitations, assign-to-project. The roster already shows **emails**.
- **Contractor documents** are already keyed per user (`contractor_documents.contractor_id`
  → `auth.users`), with an upload + verify/reject review flow. Surfacing them per
  member is a front-end move — **no schema change**.
- **The approval engine already supports multi-step chains, per-entity-type
  policies, and amount thresholds**: `approval_policies(entity_type, step_order,
  approver_role, min_amount_cents)`, seeded by `seed_approval_steps()`, ordered by
  `enforce_approval_order`, finalized by `finalize_approval()`, with separation-of-
  duties via `enforce_approval_sod`. Today's UI only exposes a single uniform
  second-approver via `set_org_approval_policy(org, second_role)`.

Genuinely **new**: an admin-triggered password reset, and a UI + RPC to configure
the per-entity-type approval matrix.

## Decisions (confirmed)

- **Approvers are roles**, not named people (owner/admin/finance/pm/…). No schema
  change; "who and who" = "which role then which role." Named-person approvals are
  explicitly out of scope.
- **Passwords:** admin action **sends a Supabase reset email**; the admin never
  sets/sees the password. No temp-password / force-change flow.

## Approach — two slices

Ship Slice 1 (reorg + member center, low risk) first; Slice 2 (approval matrix)
second. Each is an independent PR.

## Slice 1 — Member-management center + reorg

### Tab restructure (`/org`)
`General · Security · Policies · Domains · Members · Integrations`
- Remove the persistent "Manage" strip; **Members** becomes its own tab.
- **Drop the Finance link** (Finance has its own nav item).
- **Keep the Audit log** as a link at the top of the Members tab.

### Members tab
Move the existing `/org/members` management inline into `/org?tab=members` and
enrich each member row. `/org/members` redirects to `/org?tab=members` (preserve
the deep link). Reuses `members-roster.tsx`, `listOrgMembers`, and the existing
actions unchanged for:
- role/member_type change, block (`disabled`) / reactivate, remove, email display,
  invite form, pending-invitations list (resend/revoke).

**New — Reset password.** A per-member "Reset password" action → server action
`sendMemberPasswordReset(orgId, userId)`:
- Gated by `member:manage` (owner/admin). Targeting yourself is harmless (it just
  emails you), so no self-check is needed.
- Resolves the member's email (from `profiles`/membership, scoped to the org) and
  calls Supabase auth password-recovery for that email (reset link → member sets
  their own password). Audit-logged (`member.password_reset_sent`). No secrets, no
  admin-set password.

**Contractor docs per member.** For `member_type = 'contractor'` members, show their
`contractor_documents` inline (doc type, status badge submitted/verified/rejected,
file link, expiry) with the existing verify/reject controls
(`verifyContractorDocument` / `rejectContractorDocument`, gated by `payment:record`).
Data via a new `listContractorDocuments(orgId, contractorId)` reader (RLS already
allows org staff to read). The bulk `/org/documents` page stays reachable.

### The "approval right = role" framing
A member's right to approve **is their role** (PM/Admin/Owner can approve per
`permissions.ts`; Finance/Member/Viewer can't). The Members tab shows a small
"can approve" hint on approver-capable roles so it's legible. Configuring *what*
gets approved lives in Slice 2 (Policies).

## Slice 2 — Approval matrix (Policies tab)

Replace the single second-approver dropdown with a per-entity-type matrix over the
five live entity types (task_plan, task_variation, extension, payment, request; the
retired `variation`/`variation_orders` type is excluded).
Per row the admin sets an **ordered role chain** (step 1 fixed to PM — the engine's
first step; steps 2..N chosen from admin/finance/pm/viewer/none) and an optional
**amount threshold** (`min_amount_cents`) above which the extra step(s) apply.

- **New RPC `set_org_approval_matrix(p_org_id uuid, p_rows jsonb)`** generalizing
  `set_org_approval_policy`: SECURITY DEFINER, re-checks `is_org_admin`; replaces the
  org's `approval_policies` rows from the supplied per-entity-type config
  (entity_type, ordered approver_role steps, min_amount_cents). **No table/schema
  change** — the columns already exist. `set_org_approval_policy` is kept for
  backward compatibility (it becomes a thin uniform case) until the UI fully
  replaces it.
- **Reader:** `getOrgApprovalMatrix(orgId)` returns the current per-entity-type
  chains for the UI to render.
- UI: a table (rows = entity types; columns = step 1..N role selects + threshold
  input), one Save. Reuses existing `Card`/`inputClass`/`SubmitButton`.
- Engine unchanged: `seed_approval_steps` already reads these policies with the
  threshold filter; `finalize_approval` already routes by entity type. So richer
  policies take effect with no engine edits.

## Security

- All member-management + approval-config actions gate on `member:manage`
  (owner/admin) at the app layer, and **RLS/SECURITY-DEFINER re-checks at the DB**
  (organizations/org_members RLS; `set_org_approval_matrix` re-checks `is_org_admin`;
  contractor-doc review RLS unchanged). SoD (`enforce_approval_sod`) and order
  (`enforce_approval_order`) triggers are untouched.
- Password reset only triggers Supabase's standard recovery email — no admin API
  password set, no service-role exposure to the client.

## Out of scope (deferred)

Named-person approvers; temporary/admin-set passwords + force-change; SSO;
Integrations; multi-approver "N of M" quorums; per-project (vs per-org) approval
policies.

## Testing

- **Slice 1:** `pnpm typecheck` + eslint clean. Manual: Members tab shows roster
  with email/role/status; block→reactivate round-trips; Reset password emails the
  member (audit row written); a contractor member shows their docs with working
  verify/reject; `/org/members` redirects to the tab; Finance link gone; Audit link
  present.
- **Slice 2:** typecheck + eslint clean. A rolled-back psql check (in
  `supabase/tests/`) that `set_org_approval_matrix` writes the expected
  `approval_policies` rows per entity type + threshold, that a non-admin call is
  rejected, and that `seed_approval_steps` then materialises the configured chain
  for an above-threshold entity. Manual: set a 3-role chain with a threshold, raise
  a matching entity, confirm the steps seed in order.
