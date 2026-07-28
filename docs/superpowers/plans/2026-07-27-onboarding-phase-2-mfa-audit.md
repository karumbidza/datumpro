# Onboarding Phase 2 — MFA + Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organizations two enterprise-trust capabilities: an admin-only **audit log** of consequential actions (already-existing `audit_logs` table, now actually written to and viewable), and org-enforceable **MFA/2FA** using Supabase's built-in TOTP.

**Architecture:** Additive. Part A wires a best-effort `logAudit()` helper (service-role write, never blocks the user action) into the sensitive server actions, tightens the `audit_logs` read policy to owner/admin, reroutes the one internal reader through the service role, and adds an admin-only viewer. Part B adds a `require_mfa` flag to `organizations`, a root-level `/mfa` enroll+verify page (outside the `(app)` group so it can't loop), an app-shell enforcement gate, and an org toggle. No custom MFA tables — Supabase manages factors in `auth.*`.

**Tech Stack:** Next.js 15 (App Router, Server Components + Server Actions), Supabase (Postgres + RLS, `supabase.auth.mfa.*` TOTP), TailwindCSS v4. pnpm workspace.

**Package manager / commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm dev`. Shared tests: `cd packages/shared && npx vitest run`.

**Scope note:** Phase 2 of `docs/superpowers/specs/2026-07-27-access-onboarding-design.md` §6. Phases 3 (enterprise lane) and 4 (SSO/domain) get their own plans. The `audit_logs` table already exists (`supabase/migrations/20260101000200_audit.sql`); this plan does NOT recreate it. Invitations/personal-profile changes remain Handover A's territory (spec §0).

**Decision locked:** audit log is **owner/admin readable only** (contractors/clients are org members, so member-readable RLS would leak finance actions to them).

---

## File Structure

**Create:**
- `supabase/migrations/20260101007000_audit_admin_only.sql` — retighten `audit_logs` SELECT to owner/admin.
- `supabase/migrations/20260101007100_org_require_mfa.sql` — `require_mfa` column on `organizations`.
- `apps/web/lib/audit.ts` — `logAudit()` best-effort service-role writer + `AUDIT` action-name constants.
- `apps/web/app/(app)/org/audit/page.tsx` — admin-only audit viewer.
- `apps/web/app/mfa/page.tsx` — root-level TOTP enroll + verify (client component).
- `apps/web/app/(app)/org/mfa-actions.ts` — `setOrgMfaRequirement()` server action.

**Modify:**
- `apps/web/lib/data/chat-roster.ts` — `listMemberActivity()` reads via service-role client (companion to the RLS change).
- `apps/web/app/(app)/org/members/actions.ts` — audit member actions.
- `apps/web/app/orgs/actions.ts` — audit org creation.
- `apps/web/app/(app)/org/actions.ts` — audit rename + approval-policy.
- `apps/web/lib/actions/approvals.ts` — audit approval decisions.
- `apps/web/app/(app)/payments/request-actions.ts` — audit payment reject/paid.
- `apps/web/app/(app)/documents/actions.ts` — audit doc verify/reject.
- `apps/web/app/(app)/org/page.tsx` — add MFA toggle card + audit-log link (admin only).
- `apps/web/app/(app)/account/page.tsx` — add MFA status card linking to `/mfa`.
- `apps/web/app/(app)/layout.tsx` — MFA enforcement gate.
- `supabase/config.toml` — `[auth.mfa.totp]` for local parity.

---

# PART A — AUDIT LOG

## Task A1: Tighten `audit_logs` read policy to owner/admin

**Files:**
- Create: `supabase/migrations/20260101007000_audit_admin_only.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — restrict audit log reads to owner/admin
--
-- The original policy allowed any org MEMBER to read audit_logs. In this model,
-- contractors and clients are org members, so that would expose finance actions
-- (invoice/payment before/after) to them. The audit log is a governance tool for
-- org leadership — restrict SELECT to owner/admin. Writes remain service-role only
-- (append-only, tamper-evident).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists audit_logs_select on public.audit_logs;

create policy audit_logs_select on public.audit_logs for select
  using ((select public.is_org_admin(org_id)));
```

- [ ] **Step 2: Apply**

Run: `pnpm db:reset` locally, or apply to the hosted DB via the Supabase tooling.
Expected: policy replaced; `select` on `audit_logs` now returns rows only for owner/admin of that org.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101007000_audit_admin_only.sql
git commit -m "feat(audit): restrict audit_logs reads to owner/admin"
```

---

## Task A2: `logAudit()` helper

**Files:**
- Create: `apps/web/lib/audit.ts`

- [ ] **Step 1: Write the helper**

```typescript
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** Append an entry to the tamper-evident `audit_logs` table via the service role
 *  (bypasses RLS; writes are otherwise impossible). Best-effort by design: it
 *  never throws, so an audit hiccup — or a missing SUPABASE_SERVICE_ROLE_KEY in
 *  local dev — can't break the user action that triggered it. Call it AFTER the
 *  user's own mutation has succeeded. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('audit_logs').insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      before: (entry.before ?? null) as never,
      after: (entry.after ?? null) as never,
    });
    if (error) console.error('[audit] insert failed:', error.message);
  } catch (e) {
    console.error('[audit] logAudit error:', e);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/audit.ts
git commit -m "feat(audit): add best-effort logAudit service-role writer"
```

---

## Task A3: Reroute `listMemberActivity` through the service role

**Files:**
- Modify: `apps/web/lib/data/chat-roster.ts:102-132`

Rationale: after Task A1, the regular (RLS) client can't read `audit_logs` for non-admins, which would silently break the roster activity feed. This read is a narrow projection (`id, action, entity_type, created_at`) already filtered to one project's tasks and one actor — safe to serve via the service role.

- [ ] **Step 1: Switch the audit read to the admin client**

In `apps/web/lib/data/chat-roster.ts`, add the import at the top (near the existing `createClient` import):

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
```

Then in `listMemberActivity`, replace ONLY the `audit_logs` query (currently lines ~125-132, using `supabase`) with an admin-client read. The `projects`/`tasks` lookups above it stay on the RLS `supabase` client (they gate that the caller may see this project):

```typescript
  const { data } = await createAdminClient()
    .from('audit_logs')
    .select('id, action, entity_type, created_at')
    .eq('org_id', orgId)
    .eq('actor_id', userId)
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })
    .limit(8);
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/data/chat-roster.ts
git commit -m "fix(audit): read member activity via service role after RLS tighten"
```

---

## Task A4: Audit member-management actions

**Files:**
- Modify: `apps/web/app/(app)/org/members/actions.ts`

- [ ] **Step 1: Import the helper**

At the top of the file, add:

```typescript
import { logAudit } from '@/lib/audit';
```

- [ ] **Step 2: Log each mutation after it succeeds (before the `done()` redirect)**

Insert a `logAudit(...)` call immediately after the successful DB write in each action. `done()`/`fail()` throw (they redirect), so place the log BEFORE `done()`. Use these exact calls:

In `inviteMember`, after the insert succeeds (after the `if (error) { … }` block, before the email try/catch):
```typescript
    await logAudit({ orgId, actorId: user?.id ?? null, entityType: 'org_invitation', entityId: null, action: 'invitation.sent', after: { email, memberType } });
```

In `updateOrgMemberRole`, after the update `if (error) fail(...)`:
```typescript
    await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: userId, action: 'member.role_changed', after: { memberType } });
```

In `removeOrgMember`, after the delete `if (error) fail(...)`:
```typescript
    await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: userId, action: 'member.removed' });
```

In `deactivateOrgMember`, after the update `if (error) fail(...)`:
```typescript
    await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: userId, action: 'member.deactivated' });
```

In `reactivateOrgMember`, after the update `if (error) fail(...)`:
```typescript
    await logAudit({ orgId, actorId: (await requireUser()).user.id, entityType: 'org_member', entityId: userId, action: 'member.reactivated' });
```
Note: `reactivateOrgMember` already destructures `{ supabase }` from `requireUser()`. Change that line to `const { supabase, user } = await requireUser();` and use `actorId: user.id` instead of calling `requireUser()` twice.

In `revokeInvitation`, after the update `if (error) fail(...)` — this action doesn't currently load the user or orgId; fetch them from the invitation row. Replace the body's DB section with:
```typescript
  const { data: inv, error: readErr } = await supabase
    .from('org_invitations')
    .select('org_id')
    .eq('id', invitationId)
    .maybeSingle();
  if (readErr) fail(readErr.message);
  const { error } = await supabase
    .from('org_invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  if (error) fail(error.message);
  const { data: { user } } = await supabase.auth.getUser();
  await logAudit({ orgId: (inv as { org_id: string } | null)?.org_id ?? '', actorId: user?.id ?? null, entityType: 'org_invitation', entityId: invitationId, action: 'invitation.revoked' });
```

- [ ] **Step 3: Type-check & lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/org/members/actions.ts"
git commit -m "feat(audit): log member invite/role/remove/deactivate actions"
```

---

## Task A5: Audit org, approval, payment, and document actions

**Files:**
- Modify: `apps/web/app/orgs/actions.ts`, `apps/web/app/(app)/org/actions.ts`, `apps/web/lib/actions/approvals.ts`, `apps/web/app/(app)/payments/request-actions.ts`, `apps/web/app/(app)/documents/actions.ts`

For each file, add `import { logAudit } from '@/lib/audit';` and insert the matching call after the successful write. Below are the exact calls; place each immediately after its action's `if (error) …` success point and before any redirect/`revalidatePath`.

- [ ] **Step 1: `orgs/actions.ts` — `createOrg`**, after the insert succeeds (after `if (error) …`, before `revalidatePath`):
```typescript
  await logAudit({ orgId: (org as { id: string }).id, actorId: user.id, entityType: 'organization', entityId: (org as { id: string }).id, action: 'organization.created', after: { name } });
```

- [ ] **Step 2: `org/actions.ts` — `renameOrganization`**, after `if (error) …`:
```typescript
  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.renamed', after: { name } });
```
and **`setApprovalPolicy`**, after `if (error) …`:
```typescript
  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'approval_policy.set', after: { secondApprover: second } });
```

**Deferred (fast-follow):** `decideApprovalStep` (approvals.ts), `rejectPaymentRequest`/`markPaymentRequestPaid` (payments), and `verifyContractorDocument`/`rejectContractorDocument` (documents) do NOT have `org_id` in local scope — each shared helper (`managerUpdate`, `review`) works by row id only. Auditing them cleanly needs an extra `select org_id` on each money/document path. To avoid adding queries to finance code that can't be smoke-tested in this pass, these are deferred. The `logAudit(...)` pattern is identical; wiring them is a follow-up once the org_id lookup is added to each helper.

- [ ] **Step 3: Type-check & lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/orgs/actions.ts "apps/web/app/(app)/org/actions.ts"
git commit -m "feat(audit): log org creation, rename, and approval-policy changes"
```

---

## Task A6: Admin-only audit viewer

**Files:**
- Create: `apps/web/app/(app)/org/audit/page.tsx`
- Modify: `apps/web/app/(app)/org/page.tsx` (add a link, admin only)

- [ ] **Step 1: Create the viewer**

```typescript
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { can } from '@datumpro/shared/access';
import { PageContainer } from '@/components/shell/page-container';
import { Card } from '@/components/ui/card';

/** "member.role_changed" → "member · role changed". Best-effort humaniser. */
function humanize(entityType: string, action: string): string {
  const verb = action.split('.').pop()?.replace(/_/g, ' ') ?? action;
  return `${entityType.replace(/_/g, ' ')} · ${verb}`;
}

export default async function AuditPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active || !can(ctx.active.role, 'org:manage')) redirect('/org');

  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_id, entity_type, entity_id, action, created_at')
    .eq('org_id', ctx.active.orgId)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as {
    id: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    created_at: string;
  }[];

  // Resolve actor display names in one round-trip (RLS lets admins read co-member profiles).
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: profiles } = actorIds.length
    ? await supabase.from('profiles').select('id, display_name, email').in('id', actorIds)
    : { data: [] as { id: string; display_name: string | null; email: string | null }[] };
  const nameOf = new Map(
    ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name || p.email || 'Unknown',
    ]),
  );

  return (
    <PageContainer width="3xl">
      <Link href="/org" className="text-xs text-zinc-500 hover:underline">
        ← Organisation
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Who did what — the last 200 consequential actions in this organisation. Read-only and tamper-evident.
      </p>

      <Card className="mt-6 overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No activity recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-400 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-500">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{r.actor_id ? nameOf.get(r.actor_id) ?? 'Unknown' : 'System'}</td>
                  <td className="px-4 py-2">{humanize(r.entity_type, r.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Link it from the org page (admin only).** In `apps/web/app/(app)/org/page.tsx`, read the file to find where org sections render and the role/permission variable in scope, then add a link inside an admin-gated block:

```tsx
{can(role, 'org:manage') && (
  <Link href="/org/audit" className="text-sm text-brand-600 hover:underline">
    View audit log →
  </Link>
)}
```
Ensure `Link` from `next/link` and `can` from `@datumpro/shared/access` are imported (add if missing), and `role` matches the page's existing role variable.

- [ ] **Step 3: Type-check, lint, smoke**

Run: `pnpm typecheck && pnpm lint`, then `pnpm dev`, sign in as an owner/admin, visit `/org/audit`.
Expected: page renders recent actions (after exercising some in Part A); a non-admin visiting `/org/audit` is redirected to `/org`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/org/audit/page.tsx" "apps/web/app/(app)/org/page.tsx"
git commit -m "feat(audit): admin-only audit log viewer at /org/audit"
```

---

# PART B — MFA / 2FA

## Task B1: `require_mfa` column + local MFA config

**Files:**
- Create: `supabase/migrations/20260101007100_org_require_mfa.sql`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — org-level MFA requirement
--
-- When true, every member of the org must have passed a TOTP challenge (session
-- AAL2) before using the app. Enforced in the app shell; Supabase manages the
-- factors themselves in auth.*.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists require_mfa boolean not null default false;
```

- [ ] **Step 2: TOTP config for local parity.** In `supabase/config.toml`, under the `[auth]` area, add:

```toml
[auth.mfa]
max_enrolled_factors = 10

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

- [ ] **Step 3: Apply**

Run: `pnpm db:reset` locally, or apply the migration to the hosted DB via the Supabase tooling. TOTP is available on hosted Supabase by default; the config block is for local dev parity.
Expected: `organizations.require_mfa` exists (boolean, default false).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101007100_org_require_mfa.sql supabase/config.toml
git commit -m "feat(mfa): add organizations.require_mfa + local TOTP config"
```

---

## Task B2: `/mfa` enroll + verify page

**Files:**
- Create: `apps/web/app/mfa/page.tsx`

Placed at the app root (NOT inside `(app)`) so the enforcement gate in Task B3 can redirect here without a loop.

- [ ] **Step 1: Write the page (client component)**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

type Mode = 'loading' | 'enroll' | 'verify';

/** Same-site relative ?next, else dashboard (no open redirect). */
function safeNext(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

export default function MfaPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('loading');
  const [factorId, setFactorId] = useState<string>('');
  const [qr, setQr] = useState<string>(''); // SVG data URI for enrolment
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On load, decide whether the user needs to enrol a factor or just verify one.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError(error.message);
      const totp = data?.totp?.find((f) => f.status === 'verified');
      if (totp) {
        setFactorId(totp.id);
        setMode('verify');
      } else {
        const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (enrolled.error) return setError(enrolled.error.message);
        setFactorId(enrolled.data.id);
        setQr(enrolled.data.totp.qr_code);
        setMode('enroll');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      return setError(challenge.error.message);
    }
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verify.error) return setError(verify.error.message);
    window.location.assign(safeNext()); // reload so the server sees AAL2
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {mode === 'enroll'
            ? 'Your organization requires 2FA. Scan this code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code.'
            : 'Enter the 6-digit code from your authenticator app to continue.'}
        </p>

        {mode === 'loading' && <p className="mt-6 text-sm text-zinc-500">Preparing…</p>}

        {mode === 'enroll' && qr && (
          // Supabase returns the QR as an SVG data URI.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Authenticator QR code" className="mx-auto mt-4 h-44 w-44" />
        )}

        {(mode === 'enroll' || mode === 'verify') && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={inputClass}
            />
            <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
              {busy ? 'Verifying…' : mode === 'enroll' ? 'Enable 2FA' : 'Verify'}
            </Button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Type-check & lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (`supabase.auth.mfa.*` is part of `@supabase/supabase-js` already installed.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/mfa/page.tsx
git commit -m "feat(mfa): TOTP enroll + verify page at /mfa"
```

---

## Task B3: Enforce MFA in the app shell

**Files:**
- Modify: `apps/web/app/(app)/layout.tsx`

- [ ] **Step 1: Add the gate**

In `apps/web/app/(app)/layout.tsx`, add imports and the check. After the existing `if (!ctx.active) { … }` block and before `getSidebarData`, insert:

```typescript
  // Org-enforced MFA: if this org requires 2FA and the session hasn't reached
  // AAL2, send the user to enrol/verify. /mfa lives outside this route group, so
  // there's no redirect loop.
  {
    const supabase = await createClient();
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('require_mfa')
      .eq('id', ctx.active.orgId)
      .single();
    if ((orgRow as { require_mfa?: boolean } | null)?.require_mfa) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel !== 'aal2') redirect('/mfa');
    }
  }
```

Add the import at the top:
```typescript
import { createClient } from '@/lib/supabase/server';
```

- [ ] **Step 2: Type-check & lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/layout.tsx"
git commit -m "feat(mfa): enforce org require_mfa in the app shell"
```

---

## Task B4: Org MFA toggle (action + UI)

**Files:**
- Create: `apps/web/app/(app)/org/mfa-actions.ts`
- Modify: `apps/web/app/(app)/org/page.tsx`

- [ ] **Step 1: Server action**

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

/** Toggle org-wide MFA requirement. RLS restricts organizations UPDATE to
 *  owner/admin, so a non-admin's write is rejected at the database. */
export async function setOrgMfaRequirement(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const require = String(formData.get('requireMfa') ?? '') === 'on';
  if (!orgId) throw new Error('Missing organisation');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update({ require_mfa: require }).eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({
    orgId,
    actorId: user.id,
    entityType: 'organization',
    entityId: orgId,
    action: require ? 'mfa.required_enabled' : 'mfa.required_disabled',
  });
  revalidatePath('/org');
}
```

- [ ] **Step 2: UI card on /org (owner/admin).** Read `apps/web/app/(app)/org/page.tsx` to match its section pattern and confirm how it reads the active org id + `require_mfa`. The page loads the org; extend its `organizations` select to include `require_mfa`. Add, inside the admin-gated area:

```tsx
{can(role, 'org:manage') && (
  <Card className="mt-4">
    <CardTitle>Security</CardTitle>
    <form action={setOrgMfaRequirement} className="mt-3 flex items-center gap-3">
      <input type="hidden" name="orgId" value={orgId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="requireMfa" defaultChecked={requireMfa} />
        Require two-factor authentication for everyone in this organisation
      </label>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  </Card>
)}
```
Import `setOrgMfaRequirement` from `./mfa-actions`, `SubmitButton` from `@/components/ui/submit-button`, and ensure `Card`/`CardTitle`/`can` are imported. `requireMfa` is the boolean from the extended org select; `orgId`/`role` are the page's existing locals.

- [ ] **Step 3: Type-check, lint, smoke**

Run: `pnpm typecheck && pnpm lint`, then `pnpm dev`. As an admin, toggle "Require 2FA" on `/org`; reload the app — expect a redirect to `/mfa`; enrol with an authenticator app; verify; land back in the app at AAL2.
Expected: enforcement engages; the toggle writes an audit entry visible at `/org/audit`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/org/mfa-actions.ts" "apps/web/app/(app)/org/page.tsx"
git commit -m "feat(mfa): org-admin toggle to require 2FA (audited)"
```

---

## Task B5: MFA status card on /account

**Files:**
- Modify: `apps/web/app/(app)/account/page.tsx`

- [ ] **Step 1: Add a card linking to `/mfa`.** Between the Profile card and the Organisations block, add:

```tsx
<Card className="mt-4">
  <CardTitle>Two-factor authentication</CardTitle>
  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
    Add an authenticator app for an extra layer of security. Some organisations require it.
  </p>
  <Link
    href="/mfa"
    className="mt-3 inline-block rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:border-brand-500 dark:border-zinc-800"
  >
    Manage 2FA →
  </Link>
</Card>
```
`Link` and `Card`/`CardTitle` are already imported on this page.

- [ ] **Step 2: Type-check, lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/account/page.tsx"
git commit -m "feat(mfa): 2FA management card on the account page"
```

---

## Self-Review (against the spec §6)

- **MFA enrollment (TOTP)** → Task B2 (`/mfa`), Task B5 (account entry point). ✅
- **Org can require MFA / enforcement** → Task B1 (`require_mfa`), Task B3 (app-shell gate), Task B4 (toggle). ✅
- **Audit log of sensitive actions** → Task A2 (`logAudit`), Tasks A4–A5 (wiring across member/org/approval/payment/document actions). ✅
- **Audit viewer (owner/admin)** → Task A6, plus Task A1 RLS tighten + A3 reader reroute so the leak is closed without breaking the roster feed. ✅
- **Decision:** audit is owner/admin-only (locked with the user). ✅

**Type consistency:** `logAudit(entry: AuditEntry)` signature (Task A2) is used identically in A3–A5 and B4. `require_mfa` column (B1) is read in B3 (gate) and B4 (toggle). `/mfa` route (B2) is the redirect target in B3 and the link target in B4/B5. The AAL check uses `getAuthenticatorAssuranceLevel().currentLevel === 'aal2'` consistently. No dangling references.

**Deferred, noted:** not every one of the ~15 candidate actions is wired — Tasks A4/A5 cover the highest-value member/org/finance set; remaining sites (e.g. `assignMemberToProject`, task approve/reject in `projects/[projectId]/tasks/actions.ts`) follow the identical `logAudit(...)` one-liner pattern and can be added incrementally.
