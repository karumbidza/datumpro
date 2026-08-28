# Org Member-Management Center (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the org **Members** tab the center of org admin — move member management inline into `/org?tab=members`, add an admin "Reset password" (sends the member a Supabase recovery email), surface each contractor-member's compliance documents with verify/reject, drop the Finance link, and keep the Audit link.

**Architecture:** Extract the existing `/org/members` management UI (invite + pending invitations + roster) into a reusable server component `MembersPanel`, rendered by the new **Members** tab in the already-tabbed `/org` page. `/org/members` becomes a redirect to `/org?tab=members`. Member server-actions redirect back to `/org?tab=members`. Approvers stay role-based; no schema change in this slice.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (RLS + `auth.resetPasswordForEmail`), Tailwind. Reuses existing `Card`/`SubmitButton`/`Badge`/`MembersRoster`/`review-document` primitives.

**Testing reality:** This codebase has no component/action unit-test harness (frontend is gated by `pnpm -C apps/web typecheck` + eslint + manual/Vercel-preview). Each task's gate is therefore **typecheck + eslint clean** plus an explicit **manual verification** step. (Automated DB tests come in Slice 2's RPC.)

**Spec:** `docs/superpowers/specs/2026-08-28-org-member-management-and-approval-matrix-design.md`

---

## File Structure

- **Create** `apps/web/components/org/members-panel.tsx` — server component: notice banner + invite card + pending invitations + roster. One responsibility: render the members-management surface from props.
- **Create** `apps/web/components/org/member-documents.tsx` — client component: a contractor-member's compliance docs with verify/reject (wraps existing `review-document`).
- **Modify** `apps/web/app/(app)/org/members/actions.ts` — redirect base `/org/members` → `/org?tab=members`; add `sendMemberPasswordReset`.
- **Modify** `apps/web/components/org/members-roster.tsx` — add a "Reset password" action per member; render `MemberDocuments` for contractor members.
- **Modify** `apps/web/lib/data/contractor-documents.ts` — add `listOrgContractorDocuments(orgId)` grouped reader (if not already present).
- **Modify** `apps/web/app/(app)/org/page.tsx` — add the **Members** tab; render `MembersPanel`; move the Audit link into the Members tab; drop the Finance link + remove the persistent "Manage" strip.
- **Replace** `apps/web/app/(app)/org/members/page.tsx` — redirect to `/org?tab=members`.

---

### Task 1: `sendMemberPasswordReset` server action + redirect base

**Files:**
- Modify: `apps/web/app/(app)/org/members/actions.ts`

- [ ] **Step 1: Point the redirect base at the Members tab**

In `apps/web/app/(app)/org/members/actions.ts`, change the constant:

```ts
const MEMBERS = '/org?tab=members';
```

(The existing `fail()`/`done()` helpers build on `MEMBERS` with `?`/`&` — verify they still produce valid URLs; `fail` uses `${MEMBERS}?error=` which becomes `/org?tab=members?error=` — change those to `&`. Search the file for `${MEMBERS}?` and replace `?` with `&`. Bare `redirect(MEMBERS)` / `done()` are unaffected.)

- [ ] **Step 2: Add the action** (model it on `deactivateOrgMember` — same `requireUser()` + `fail()`/`done()` + `logAudit` pattern)

Append to `actions.ts`:

```ts
/** Admin-triggered password reset: emails the member a Supabase recovery link so
 *  they set their own password. The admin never sees or sets it. member:manage is
 *  enforced by RLS on org_members (the caller must be able to read the target); we
 *  only email an address that belongs to a member of this org. */
export async function sendMemberPasswordReset(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase, user } = await requireUser();

  // Resolve the target's email, scoped to this org (a non-member returns no row).
  const { data: membership } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) fail('That person is not a member of this organisation.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  const email = (profile as { email?: string | null } | null)?.email ?? null;
  if (!email) fail('That member has no email on file.');

  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) fail(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: userId, action: 'member.password_reset_sent' });
  redirect(`${MEMBERS}&reset=1`);
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint "app/(app)/org/members/actions.ts"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/org/members/actions.ts"
git commit -m "feat(org): sendMemberPasswordReset action; point member actions at /org?tab=members"
```

---

### Task 2: Contractor-member documents reader + component

**Files:**
- Modify: `apps/web/lib/data/contractor-documents.ts`
- Create: `apps/web/components/org/member-documents.tsx`

- [ ] **Step 1: Add a grouped reader** (check the file first — if a per-org list already exists, reuse it and skip)

In `apps/web/lib/data/contractor-documents.ts` add:

```ts
export interface ContractorDocRow {
  id: string;
  contractorId: string;
  docType: string;
  title: string | null;
  fileName: string | null;
  status: 'submitted' | 'verified' | 'rejected';
  expiryDate: string | null;
}

/** All contractor compliance docs in the org, grouped by contractor user id.
 *  RLS already limits reads to org staff. */
export async function listOrgContractorDocuments(orgId: string): Promise<Map<string, ContractorDocRow[]>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contractor_documents')
    .select('id, contractor_id, doc_type, title, file_name, status, expiry_date')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as {
    id: string; contractor_id: string; doc_type: string; title: string | null;
    file_name: string | null; status: 'submitted' | 'verified' | 'rejected'; expiry_date: string | null;
  }[];
  const map = new Map<string, ContractorDocRow[]>();
  for (const r of rows) {
    const row: ContractorDocRow = {
      id: r.id, contractorId: r.contractor_id, docType: r.doc_type, title: r.title,
      fileName: r.file_name, status: r.status, expiryDate: r.expiry_date,
    };
    (map.get(r.contractor_id) ?? map.set(r.contractor_id, []).get(r.contractor_id)!).push(row);
  }
  return map;
}
```

(Confirm `createClient` is already imported at the top of the file; it is used by the existing readers there.)

- [ ] **Step 2: Create the display component** — reuses the existing `review-document.tsx` verify/reject controls

`apps/web/components/org/member-documents.tsx`:

```tsx
import { ReviewDocument } from '@/components/documents/review-document';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';

const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  verified: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
};

/** Inline compliance docs for one contractor member, with staff verify/reject.
 *  `canReview` gates the review controls (payment:record). */
export function MemberDocuments({ docs, canReview }: { docs: ContractorDocRow[]; canReview: boolean }) {
  if (docs.length === 0) {
    return <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">No compliance documents uploaded.</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{d.title || d.docType.replace(/_/g, ' ')}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_TONE[d.status]}`}>{d.status}</span>
          {d.expiryDate && <span className="text-zinc-400 dark:text-zinc-500">exp {new Date(d.expiryDate).toLocaleDateString('en-GB')}</span>}
          {canReview && d.status === 'submitted' && <ReviewDocument documentId={d.id} />}
        </li>
      ))}
    </ul>
  );
}
```

(Before writing, open `apps/web/components/documents/review-document.tsx` and confirm its prop name — it may be `documentId` or take the row. Match it exactly; adjust the `<ReviewDocument … />` call to the real signature.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint components/org/member-documents.tsx lib/data/contractor-documents.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/data/contractor-documents.ts apps/web/components/org/member-documents.tsx
git commit -m "feat(org): per-contractor documents reader + inline member-documents component"
```

---

### Task 3: Roster — Reset-password action + contractor docs

**Files:**
- Modify: `apps/web/components/org/members-roster.tsx`

- [ ] **Step 1: Extend the component's inputs**

Add to the `import { … } from '@/app/(app)/org/members/actions'` list: `sendMemberPasswordReset`. Import the docs component + type:

```tsx
import { MemberDocuments } from '@/components/org/member-documents';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';
```

Extend the props with an optional docs map and a review flag:

```tsx
export function MembersRoster({
  orgId, members, projects, meId, isAdmin,
  docsByContractor = new Map(), canReviewDocs = false,
}: {
  orgId: string;
  members: Member[];
  projects: { id: string; name: string }[];
  meId: string;
  isAdmin: boolean;
  docsByContractor?: Map<string, ContractorDocRow[]>;
  canReviewDocs?: boolean;
}) {
```

- [ ] **Step 2: Add the Reset-password control** (inside each member `Card`, in the actions area, only when `editable`)

```tsx
{editable && (
  <form action={sendMemberPasswordReset}>
    <input type="hidden" name="orgId" value={orgId} />
    <input type="hidden" name="userId" value={m.userId} />
    <SubmitButton variant="ghost" pendingText="Sending…">Reset password</SubmitButton>
  </form>
)}
```

- [ ] **Step 3: Render contractor docs** (after the member's detail block, when the member is a contractor)

```tsx
{m.memberType === 'contractor' && (
  <div className="mt-2 w-full border-t border-zinc-100 pt-2 dark:border-zinc-800">
    <MemberDocuments docs={docsByContractor.get(m.userId) ?? []} canReview={canReviewDocs} />
  </div>
)}
```

- [ ] **Step 4: Show the "can approve" role hint** (spec §C — a member's approval right *is* their role)

Near where the member's role/type is displayed in the `Card`, add a small badge for approver-capable roles (owner/admin/pm per `permissions.ts`):

```tsx
{['owner', 'admin', 'pm'].includes(m.role) && (
  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
    can approve
  </span>
)}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint components/org/members-roster.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/org/members-roster.tsx
git commit -m "feat(org): roster reset-password + contractor documents + can-approve hint"
```

---

### Task 4: Extract `MembersPanel`

**Files:**
- Create: `apps/web/components/org/members-panel.tsx`

- [ ] **Step 1: Create the panel** — lift the invite card + pending list + roster out of `org/members/page.tsx` (the JSX at lines ~76–150 there) into a props-driven server component. It receives already-fetched data + a notice.

```tsx
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { INVITABLE_MEMBER_TYPES, MEMBER_TYPE_META } from '@datumpro/shared/access';
import { inviteMember, revokeInvitation, resendInvitation } from '@/app/(app)/org/members/actions';
import { MembersRoster } from '@/components/org/members-roster';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';

type Member = Parameters<typeof MembersRoster>[0]['members'][number];
type Invitation = { id: string; email: string; memberType: keyof typeof MEMBER_TYPE_META; createdAt: string };

export function MembersPanel({
  orgId, meId, members, invitations, projects, docsByContractor, canReviewDocs,
}: {
  orgId: string;
  meId: string;
  members: Member[];
  invitations: Invitation[];
  projects: { id: string; name: string }[];
  docsByContractor: Map<string, ContractorDocRow[]>;
  canReviewDocs: boolean;
}) {
  return (
    <div className="space-y-8">
      <Card>
        <CardTitle>Invite someone</CardTitle>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Their organisation role sets company-wide access. Contractors are usually invited as{' '}
          <span className="font-medium">member</span> — you give them the Contractor role when you assign
          them to a project.
        </p>
        <form action={inviteMember} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={orgId} />
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-xs font-medium">Email</label>
            <input type="email" name="email" required placeholder="name@company.com" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Member type</label>
            <select name="memberType" defaultValue="staff" className={inputClass}>
              {INVITABLE_MEMBER_TYPES.map((t) => (
                <option key={t} value={t}>{MEMBER_TYPE_META[t].label}</option>
              ))}
            </select>
          </div>
          <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
        </form>
      </Card>

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Pending invitations</h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      invited as {MEMBER_TYPE_META[inv.memberType].label} · {new Date(inv.createdAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={resendInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="secondary" pendingText="Sending…">Resend</SubmitButton>
                    </form>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="ghost" pendingText="…">Revoke</SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Members ({members.length})</h2>
        <MembersRoster
          orgId={orgId} members={members} projects={projects} meId={meId} isAdmin
          docsByContractor={docsByContractor} canReviewDocs={canReviewDocs}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint components/org/members-panel.tsx`
Expected: no errors. (If `Invitation.memberType` typing complains, import the real invitation row type from `@/lib/data/org-members` instead of the inline `type Invitation`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/org/members-panel.tsx
git commit -m "feat(org): extract MembersPanel (invite + pending + roster)"
```

---

### Task 5: Wire the Members tab into `/org` + drop Finance, keep Audit

**Files:**
- Modify: `apps/web/app/(app)/org/page.tsx`

- [ ] **Step 1: Add the tab + imports**

In the `TABS` array add `{ key: 'members', label: 'Members' }` (after `domains`, before `integrations`). Add imports:

```ts
import { MembersPanel } from '@/components/org/members-panel';
import { listOrgContractorDocuments } from '@/lib/data/contractor-documents';
import { listProjects } from '@/lib/data/projects';
```

- [ ] **Step 2: Fetch the extra data** — extend the `Promise.all` (members/invitations are already fetched) with projects + docs:

```ts
const [members, invitations, secondApprover, { data: orgRow }, { data: domains }, projectRows, docsByContractor] =
  await Promise.all([
    listOrgMembers(orgId),
    listPendingInvitations(orgId),
    getOrgSecondApprover(orgId),
    supabase.from('organizations').select('require_mfa, legal_name, sector, country, registration_number').eq('id', orgId).single(),
    supabase.from('org_domains').select('id, domain, verified_at, verification_token').eq('org_id', orgId).order('created_at', { ascending: true }),
    listProjects().catch(() => []),
    listOrgContractorDocuments(orgId),
  ]);
const projects = projectRows.map((p) => ({ id: p.id, name: p.name }));
```

- [ ] **Step 3: Render the Members tab panel** — add inside `<section className="mt-6 space-y-4">`, alongside the other `{activeTab === … }` blocks:

```tsx
{activeTab === 'members' && (
  <>
    <Link href="/org/audit" className="block">
      <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
        <div className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            <ShieldAlert size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Audit log</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Who did what — a read-only record of consequential actions</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
        </div>
      </Card>
    </Link>
    <MembersPanel
      orgId={orgId} meId={ctx.userId} members={members} invitations={invitations}
      projects={projects} docsByContractor={docsByContractor} canReviewDocs={canReviewDocs}
    />
  </>
)}
```

- [ ] **Step 4: Remove the persistent "Manage" section** — delete the entire `<section className="mt-8"> … Manage … </section>` block (the `ManageLink` list for Members/Audit/Finance/Contractor docs) at the bottom of the page. Also delete the now-unused `ManageLink` helper function, the `Users`/`DollarSign`/`FileText` icon imports if no longer referenced, and `canViewFinance` if now unused. (Keep `ShieldAlert`/`ChevronRight` — used by the Audit card above.) The Finance link is intentionally dropped (Finance has its own nav item).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint "app/(app)/org/page.tsx"`
Expected: no errors, no unused-var warnings.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/org/page.tsx"
git commit -m "feat(org): Members tab hosts member management + Audit link; drop Finance link + Manage strip"
```

---

### Task 6: Redirect the standalone Members page

**Files:**
- Modify: `apps/web/app/(app)/org/members/page.tsx`

- [ ] **Step 1: Replace the page with a redirect** (preserves the deep link)

```tsx
import { redirect } from 'next/navigation';

export default async function OrgMembersPage() {
  redirect('/org?tab=members');
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint "app/(app)/org/members/page.tsx"`
Expected: no errors (unused imports removed).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/org/members/page.tsx"
git commit -m "refactor(org): redirect /org/members to /org?tab=members"
```

---

### Task 7: Full verification + PR

- [ ] **Step 1: Full typecheck + lint**

Run: `pnpm -C apps/web typecheck` then `pnpm -C apps/web exec eslint "app/(app)/org" "components/org"`
Expected: clean. (If `admin/{analytics,flags,logs}` untracked local files fail typecheck, ignore — they are not part of this change.)

- [ ] **Step 2: Manual verification** (against the Vercel preview once the branch is pushed)

  - `/org` shows tabs incl. **Members**; **no Finance link**; **no** persistent "Manage" strip.
  - **Members** tab: Audit link at top; invite form; pending invitations (if any); roster with each member's **email**, role, status.
  - Change a member's role; **block** a member → shows disabled; **reactivate** → active.
  - **Reset password** on a member → returns to `/org?tab=members&reset=1` (add a small "Reset email sent" notice if the tab reads `searchParams.reset`); the member receives a recovery email.
  - Invite a **contractor**; as that contractor upload a compliance doc; back as admin the doc shows under the member with a **verify/reject** control; verify → status flips to verified.
  - Visit `/org/members` → redirects to `/org?tab=members`.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/org-member-management
gh pr create --base main --title "feat(org): member-management center (Slice 1)" --body-file <(printf '%s\n' "Slice 1 of the org member-management redesign (spec: docs/superpowers/specs/2026-08-28-...). Members becomes its own tab hosting invite + pending + roster; adds admin Reset-password (recovery email) + inline contractor documents with verify/reject; drops the Finance link; keeps Audit. No schema change. Approval matrix is Slice 2.")'
```

---

## Notes for the implementer

- **Notice for `reset=1`:** the Members tab currently doesn't read member-action notices (invited/resent/error/reset). Optional polish: have `page.tsx` read `searchParams` for `invited`/`resent`/`assigned`/`error`/`reset` and render the same green/red banner the old members page used, above the tabs. Not required for correctness.
- **`ReviewDocument` signature:** confirm the real props of `components/documents/review-document.tsx` before Task 2 Step 2 and match them.
- **RLS is the real guard:** every action already re-checks at the DB (org_members RLS, contractor-doc review RLS). The app-layer `isAdmin`/`canReviewDocs` flags are for display only.
