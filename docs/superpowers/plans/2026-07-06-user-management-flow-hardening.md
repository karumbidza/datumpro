# User-management flow hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add member deactivate/reactivate (soft off-boarding) and invitation resend to the DatumPro org member-management flow, so a team can onboard, re-role, and off-board users cleanly.

**Architecture:** Pure `apps/web` app-layer change — new server actions on `org_members.status` (the `disabled` enum value already exists and is honored by the `is_org_member`/`org_role` RLS helpers) and a resend action that reuses the existing Resend email path. No database migration.

**Tech Stack:** Next.js App Router (server actions, server + client components), Supabase JS (`@/lib/supabase/server`), Tailwind, existing `@/components/ui/*` primitives.

**Testing note:** `apps/web` has **no unit-test harness** (only `packages/shared` uses vitest). Per the existing codebase convention, verification for these UI/server-action changes is **`pnpm --filter @datumpro/web typecheck`** + **`pnpm --filter @datumpro/web build`** + manual check. Do not add a test framework to `apps/web`.

**Spec:** `docs/superpowers/specs/2026-07-06-user-management-flow-hardening-design.md`

## File map

- `apps/web/lib/data/org-members.ts` — `listOrgMembers` returns active **and** disabled members, each with `status`.
- `apps/web/app/(app)/org/members/actions.ts` — new `deactivateOrgMember`, `reactivateOrgMember`, `resendInvitation`.
- `apps/web/components/org/members-roster.tsx` — status controls (Deactivate/Reactivate), muted disabled rows, confirm-gated Remove.
- `apps/web/app/(app)/org/members/page.tsx` — Resend button on pending invitations.

---

### Task 1: Data layer — include disabled members + status

**Files:**
- Modify: `apps/web/lib/data/org-members.ts` (the `OrgMemberRow` interface, lines 4-9; `listOrgMembers`, lines 25-46)

- [ ] **Step 1: Add `status` to `OrgMemberRow`**

Replace the `OrgMemberRow` interface (lines 4-9) with:

```ts
export interface OrgMemberRow {
  userId: string;
  name: string;
  email: string | null;
  role: OrgRole;
  status: 'active' | 'disabled';
}
```

- [ ] **Step 2: Return active + disabled from `listOrgMembers`**

Replace `listOrgMembers` (lines 25-46) with:

```ts
/** Active + disabled members of an org, with display name/email. RLS scopes to
 *  the org. Active first, then disabled (so they can be reactivated). */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('user_id, role, status, profiles(display_name, email)')
    .eq('org_id', orgId)
    .in('status', ['active', 'disabled']);
  const rows = ((data ?? []) as {
    user_id: string;
    role: string;
    status: string;
    profiles:
      | { display_name: string | null; email: string | null }
      | { display_name: string | null; email: string | null }[]
      | null;
  }[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      userId: m.user_id,
      name: p?.display_name || p?.email || 'Member',
      email: p?.email ?? null,
      role: (m.role ?? 'member') as OrgRole,
      status: (m.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
    };
  });
  // Active first, then disabled.
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @datumpro/web typecheck`
Expected: PASS (no errors). Note: `members-roster.tsx` consumes `OrgMemberRow`-shaped data but via its own local `Member` interface, so adding a field here does not break it yet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/data/org-members.ts
git commit -m "feat(members): list disabled members with status for reactivation"
```

---

### Task 2: Server actions — deactivate / reactivate

**Files:**
- Modify: `apps/web/app/(app)/org/members/actions.ts` (append after `removeOrgMember`, i.e. after line 98)

- [ ] **Step 1: Add the two actions**

Insert this block after the `removeOrgMember` function (after line 98, before `assignMemberToProject`):

```ts
/** Soft off-boarding: set a member's status to 'disabled'. The is_org_member /
 *  org_role RLS helpers filter on status='active', so a disabled member loses
 *  all org access immediately while their row (and history) is preserved.
 *  Owner/admin only (RLS); can't disable yourself or the owner. */
export async function deactivateOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase, user } = await requireUser();
  if (userId === user.id) throw new Error('You cannot deactivate yourself.');

  const { data: target } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if ((target as { role?: string } | null)?.role === 'owner') {
    throw new Error('The owner cannot be deactivated.');
  }

  const { error } = await supabase
    .from('org_members')
    .update({ status: 'disabled' })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/org/members');
}

/** Restore a disabled member to 'active' at their existing role. Owner/admin
 *  only (RLS). */
export async function reactivateOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('org_members')
    .update({ status: 'active' })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/org/members');
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @datumpro/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/org/members/actions.ts"
git commit -m "feat(members): deactivate/reactivate org member server actions"
```

---

### Task 3: Roster UI — status controls, muted disabled rows, confirm Remove

**Files:**
- Modify: `apps/web/components/org/members-roster.tsx` (full replace)

- [ ] **Step 1: Replace the roster component**

Replace the entire contents of `apps/web/components/org/members-roster.tsx` with:

```tsx
'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ORG_ROLES, PROJECT_ROLES } from '@datumpro/shared/access';
import {
  updateOrgMemberRole,
  removeOrgMember,
  assignMemberToProject,
  deactivateOrgMember,
  reactivateOrgMember,
} from '@/app/(app)/org/members/actions';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

// Owner is transferred, not assigned — keep it out of the editable options.
const ASSIGNABLE_ORG_ROLES = ORG_ROLES.filter((r) => r !== 'owner');

interface Member {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  status: 'active' | 'disabled';
}

export function MembersRoster({
  orgId,
  members,
  projects,
  meId,
  isAdmin,
}: {
  orgId: string;
  members: Member[];
  projects: { id: string; name: string }[];
  meId: string;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-2">
      {members.map((m) => {
        const isSelf = m.userId === meId;
        const editable = isAdmin && !isSelf && m.role !== 'owner';
        const disabled = m.status === 'disabled';
        return (
          <Card key={m.userId} className={disabled ? 'opacity-60' : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.name}
                  {isSelf && <span className="text-zinc-400"> · you</span>}
                </p>
                {m.email && <p className="truncate text-xs text-zinc-500">{m.email}</p>}
              </div>

              <div className="flex items-center gap-2">
                {editable && !disabled ? (
                  <form action={updateOrgMemberRole}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className={inputClass}
                    >
                      {ASSIGNABLE_ORG_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </form>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'amber' : m.role === 'admin' ? 'blue' : 'neutral'}>
                    {m.role}
                  </Badge>
                )}

                {disabled && <Badge tone="neutral">disabled</Badge>}

                {editable && !disabled && (
                  <>
                    <form action={deactivateOrgMember}>
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button type="submit" variant="ghost">
                        Deactivate
                      </Button>
                    </form>
                    <form
                      action={removeOrgMember}
                      onSubmit={(e) => {
                        if (
                          !window.confirm(
                            'Remove this member permanently? This deletes their membership and history. Consider Deactivate instead.',
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button type="submit" variant="ghost">
                        Remove
                      </Button>
                    </form>
                  </>
                )}

                {editable && disabled && (
                  <form action={reactivateOrgMember}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <Button type="submit" variant="secondary">
                      Reactivate
                    </Button>
                  </form>
                )}
              </div>
            </div>

            {isAdmin && !disabled && projects.length > 0 && (
              <details className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <summary className="cursor-pointer text-xs text-brand-600 hover:underline">
                  Assign to a project
                </summary>
                <form action={assignMemberToProject} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={m.userId} />
                  <select name="projectId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Project…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select name="projectRole" defaultValue="contractor" className={inputClass}>
                    {PROJECT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="secondary">
                    Assign
                  </Button>
                </form>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify `Card` accepts `className`**

Run: `grep -n "className" apps/web/components/ui/card.tsx`
Expected: the `Card` component forwards a `className` prop (merges it into the card's classes). If it does NOT accept `className`, instead wrap the card: change `<Card key={m.userId} className={disabled ? 'opacity-60' : undefined}>` to `<div key={m.userId} className={disabled ? 'opacity-60' : undefined}><Card>` … `</Card></div>` and remove the `key`/`className` from `Card`. (Most likely `Card` already forwards `className` — confirm before changing.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @datumpro/web typecheck`
Expected: PASS. (`page.tsx` passes `members` whose rows now include `status` from Task 1, satisfying the `Member` interface.)

- [ ] **Step 4: Build**

Run: `pnpm --filter @datumpro/web build`
Expected: compiles successfully (this is a client component — the build confirms no server-only import leaked in).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/org/members-roster.tsx
git commit -m "feat(members): roster deactivate/reactivate + confirm-gated remove"
```

---

### Task 4: Invitation resend action

**Files:**
- Modify: `apps/web/app/(app)/org/members/actions.ts` (append after `revokeInvitation`, i.e. after line 134)

- [ ] **Step 1: Add `resendInvitation`**

Append this function at the end of the file (after `revokeInvitation`):

```ts
/** Re-send the invite email for an existing pending invitation, reusing its
 *  token (no new token, no status change). Admin-only (RLS on org_invitations).
 *  Email is best-effort — sends only if Resend is configured. */
export async function resendInvitation(formData: FormData) {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) throw new Error('Missing invitation');
  const supabase = await createClient();

  const { data, error: readErr } = await supabase
    .from('org_invitations')
    .select('org_id, email, role, token, status')
    .eq('id', invitationId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const inv = data as
    | { org_id: string; email: string; role: string; token: string; status: string }
    | null;
  if (!inv || inv.status !== 'pending') throw new Error('No pending invitation to resend.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: org }, { data: inviter }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', inv.org_id).single(),
    user
      ? supabase.from('profiles').select('display_name, email').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
  ]);
  const inviterName =
    (inviter as { display_name?: string; email?: string } | null)?.display_name ||
    (inviter as { email?: string } | null)?.email ||
    'A teammate';
  const { subject, html } = inviteEmail({
    orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
    inviterName,
    role: inv.role as OrgRole,
    acceptUrl: `${appUrl()}/invite/${inv.token}`,
  });
  await sendEmail({ to: inv.email, subject, html });

  revalidatePath('/org/members');
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @datumpro/web typecheck`
Expected: PASS. (`OrgRole`, `inviteEmail`, `appUrl`, `sendEmail` are already imported at the top of this file.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/org/members/actions.ts"
git commit -m "feat(members): resend a pending invitation email"
```

---

### Task 5: Resend button UI + final verification

**Files:**
- Modify: `apps/web/app/(app)/org/members/page.tsx` (import on line 6; pending-invitations block, lines 73-97)

- [ ] **Step 1: Import `resendInvitation`**

Change line 6 from:

```ts
import { inviteMember, revokeInvitation } from './actions';
```

to:

```ts
import { inviteMember, revokeInvitation, resendInvitation } from './actions';
```

- [ ] **Step 2: Add the Resend button beside Revoke**

In the pending-invitations `<Card>` (inside the `invitations.map`), replace the single revoke `<form>` (lines 86-91) with a flex group holding Resend + Revoke:

```tsx
                  <div className="flex items-center gap-1">
                    <form action={resendInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button type="submit" variant="secondary">
                        Resend
                      </Button>
                    </form>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button type="submit" variant="ghost">
                        Revoke
                      </Button>
                    </form>
                  </div>
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @datumpro/web typecheck && pnpm --filter @datumpro/web build`
Expected: both PASS.

- [ ] **Step 4: Manual verification (dev server, signed in as an org admin)**

Run: `pnpm --filter @datumpro/web dev`, sign in as an org admin (`demo@datumpro.app`), open `/org/members`.
Confirm:
- A member row shows **Deactivate** + **Remove**. Click Deactivate → the row goes muted with a "disabled" badge and a **Reactivate** button; the member loses org access. Click Reactivate → restored.
- Your own row and the owner's row have no Deactivate/Remove.
- **Remove** shows a confirm dialog before deleting.
- A pending invitation shows **Resend** + **Revoke**. Click Resend → no error (email sends only if Resend env is configured; otherwise it is a silent no-op).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/org/members/page.tsx"
git commit -m "feat(members): resend button on pending invitations"
```

---

## Definition of done

- `pnpm --filter @datumpro/web typecheck` and `pnpm --filter @datumpro/web build` both pass.
- On `/org/members` (as admin): deactivate → muted+reactivatable, reactivate → restored, remove is confirm-gated, self/owner protected, and pending invitations have a working Resend button.
- No database migration was added; no test framework was added to `apps/web`.
</content>
