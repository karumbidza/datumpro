# Spec — User-management flow hardening

**Date:** 2026-07-06
**Status:** Approved for planning
**Scope:** `apps/web` only. No database migration.

## Goal

Close the two genuinely-missing pieces in the org member-management flow so the
team can invite, onboard, re-role, and **off-board** users cleanly and test the
whole chain manually. The core flows (invite → email → accept → join, change
role, remove, revoke invitation, assign to projects) already exist and work; this
spec adds only what's missing:

1. **Member deactivate / reactivate** — soft off-boarding.
2. **Invitation resend** — re-email an existing pending invitation.

Test users and seed data are explicitly **out of scope** — the user will invite
real accounts and create data manually to exercise every feature.

## Non-goals (deferred to a later spec)

- Ownership transfer (code currently rejects assigning `owner`).
- Audit trail on role/status changes (`org_members` has no `updated_at`).
- Bulk / CSV invite, invitation expiry enforcement, invite rate-limiting.
- Any seed script or test-user provisioning.
- Mobile member-management UI.

## Background / current state

- `org_members` has `status member_status` enum = `active | invited | disabled`.
  Only `active` (and, historically, `invited`) are used; **`disabled` is defined
  but never set**.
- Access helpers `public.is_org_member(org_id)` and `public.org_role(org_id)`
  both filter on `status = 'active'`. Therefore setting a member's status to
  `disabled` **immediately removes all their access via RLS**, while preserving
  the row (their task assignments, authored reports, chat history, etc. survive).
- The `org_members` RLS write policy (`org_members_write`) already allows
  `owner`/`admin` to update rows — so **no migration or policy change is needed**
  for status updates.
- Invitations live in `org_invitations` (status `pending | accepted | revoked`),
  gated by `is_org_admin`. The invite email is sent best-effort via Resend at
  creation time; there is currently no way to re-send it.

## Part 1 — Member deactivate / reactivate

### Data model
No change. Uses the existing `org_members.status` column and `member_status`
enum. `disabled` becomes an actively-used value.

### Server actions
Add to `apps/web/app/(app)/org/members/actions.ts`:

- `deactivateOrgMember(formData)` — sets `status = 'disabled'` for the target
  `org_members` row (identified by member id + org scope, matching the existing
  `updateOrgMemberRole` pattern).
- `reactivateOrgMember(formData)` — sets `status = 'active'`.

**Guards (mirror `updateOrgMemberRole` / `removeOrgMember`):**
- Caller must have `member:manage` (owner/admin) — enforced by RLS + the existing
  permission check pattern in this file.
- Cannot deactivate **yourself**.
- Cannot deactivate the **owner**.
- On success, `revalidatePath` the members page (same as the sibling actions).

`removeOrgMember` (hard delete) stays as-is but becomes the **secondary**,
confirm-gated action in the UI (deactivate is the recommended off-boarding path).

### Data layer
`apps/web/lib/data/org-members.ts` → `listOrgMembers(orgId)` currently returns
**active** members only. Change it to return **active + disabled** members, each
carrying its `status`, so disabled members can be shown and reactivated. Sort
active first, then disabled. (Invited-status rows, if any, are not expected here —
pending invites come from `org_invitations`.)

### UI
`apps/web/components/org/members-roster.tsx`:
- Each editable member row (admin, not self, not owner) gains a status control:
  - status `active` → **Deactivate** button (→ `deactivateOrgMember`).
  - status `disabled` → **Reactivate** button (→ `reactivateOrgMember`), and the
    row renders muted (e.g. reduced opacity + a "Disabled" badge). The role
    dropdown is disabled for disabled members.
- **Remove** (hard delete) moves to a secondary position and gains a confirm step
  (e.g. `onSubmit` confirm, matching how the app confirms destructive actions —
  follow existing convention; if none, a simple `window.confirm`).
- Owner and self rows keep their current non-editable treatment.

### Behavior
Deactivating a member: their `org_members.status` → `disabled`; on their next
request RLS denies org access (they'd land on onboarding / no-org state). Their
data (assigned tasks, reports, messages) is untouched. Reactivating restores full
access at their existing role.

## Part 2 — Invitation resend

### Server action
Add to `apps/web/app/(app)/org/members/actions.ts`:

- `resendInvitation(formData)` — given an invitation id, re-load the pending
  invitation (admin RLS), and re-send the invite email via the **existing**
  `sendEmail` + `inviteEmail(...)` path used by `inviteMember`, reusing the
  invitation's existing `token` (accept link `/invite/{token}`). No new token,
  no status change. Only valid for `status = 'pending'` invitations.

### UI
`apps/web/app/(app)/org/members/page.tsx` — the pending-invitations list gains a
**Resend** button (form/action) beside the existing **Revoke** button.

### Config dependency (documented, not built here)
Email delivery requires Resend env vars **`RESEND_API_KEY`** and
**`RESEND_FROM_EMAIL`**, which are currently **unset** in production. Until set,
`sendEmail` is a best-effort no-op — the invitation record + accept link still
exist, so invites can be tested by opening `/invite/{token}` directly. Configuring
Resend (account + verified domain) is the user's responsibility and out of scope.

## Testing / verification

- `pnpm --filter @datumpro/web typecheck` — clean.
- `pnpm --filter @datumpro/web build` — clean (catches any client/server import
  issues in the actions/roster).
- Manual (authenticated as an org admin):
  - Deactivate a member → they disappear from active access; row shows as
    disabled with Reactivate. Reactivate → restored.
  - Confirm you cannot deactivate yourself or the owner (buttons absent / action
    rejected).
  - Resend a pending invitation → action succeeds (email sent if Resend is
    configured; otherwise no-op but no error). Accept link still works.

## Files affected

- `apps/web/app/(app)/org/members/actions.ts` — +`deactivateOrgMember`,
  +`reactivateOrgMember`, +`resendInvitation`.
- `apps/web/lib/data/org-members.ts` — `listOrgMembers` includes disabled + status.
- `apps/web/components/org/members-roster.tsx` — status controls, muted disabled
  rows, confirm-gated remove.
- `apps/web/app/(app)/org/members/page.tsx` — Resend button on pending invitations.
