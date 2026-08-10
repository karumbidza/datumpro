# Role-aware `/boq` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/boq` role-aware — staff get the BOQ library, contractors get an in-app tender portal, clients/viewers get nothing — enforced at the DB so contractors can no longer read the library or private budget rates.

**Architecture:** A new `is_org_staff()` DB helper distinguishes staff from contractor (both are `org_role=member` today), used to tighten the SELECT policies on `boqs`/`boq_sections`/`boq_items`/`boq_tenders`. The app surfaces `member_type` through `getActiveContext`, branches `computeNav` and `/boq/page.tsx` on it, and adds a contractor portal that lists invited tenders linking to the existing `/tender/[token]` pricing screen.

**Tech Stack:** Supabase Postgres + RLS (migration via MCP `apply_migration`), Next.js App Router server components, TypeScript. Verification: rolled-back RLS sims via MCP `execute_sql`, `supabase/tests/rls_security.sql` assertions, `pnpm turbo run typecheck lint`. **No JS test harness** — no unit-test steps.

**Spec:** `docs/superpowers/specs/2026-08-10-boq-role-aware-nav-design.md`

---

### Task 1: DB — `is_org_staff` helper + tightened SELECT policies

**Files:**
- Create: `supabase/migrations/<timestamp>_is_org_staff.sql` (get the real timestamp from MCP `apply_migration`; name it `is_org_staff`)
- Modify: `supabase/tests/rls_security.sql` (append assertions)

Context: `is_org_member`/`org_role` live in `20260101000000_init_tenancy.sql`; the BOQ library policies are in `20260101008200_boq_estimates.sql`; `boq_tenders_select` + `is_tender_bidder` are in `20260101008500_boq_tender_rls.sql`. `org_members.member_type` (enum `public.member_type`) exists since `20260101002100`.

- [ ] **Step 1: Write the migration SQL**

Create the migration file with this exact content:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — is_org_staff() + tighten BOQ library/tender reads to staff.
-- Contractors are org_role 'member' (same as staff); this helper keys on
-- member_type so RLS can hide the BOQ library + PRIVATE budget rates from them.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.member_type in ('owner','admin','pm','staff')
  );
$$;
revoke all on function public.is_org_staff(uuid) from public;
grant execute on function public.is_org_staff(uuid) to authenticated;

-- BOQ library: staff-only reads (was is_org_member).
drop policy boqs_select on public.boqs;
create policy boqs_select on public.boqs for select
  using ((select public.is_org_staff(org_id)));

drop policy boq_sections_select on public.boq_sections;
create policy boq_sections_select on public.boq_sections for select
  using ((select public.is_org_staff(org_id)));

drop policy boq_items_select on public.boq_items;
create policy boq_items_select on public.boq_items for select
  using ((select public.is_org_staff(org_id)));

-- Tenders: staff see all; a contractor sees only tenders they bid on.
drop policy boq_tenders_select on public.boq_tenders;
create policy boq_tenders_select on public.boq_tenders for select
  using ((select public.is_org_staff(org_id)) or (select public.is_tender_bidder(id)));
```

- [ ] **Step 2: Apply the migration to the remote project**

Use MCP `apply_migration` with `name: "is_org_staff"` and the SQL from Step 1. It returns/records a timestamped version — save the migration file under `supabase/migrations/` with that timestamp so local and remote match.

Expected: success, no error. (If a policy name differs from the drop target, MCP errors — read the message, confirm the real policy name via `list_tables`/pg_policies, and adjust the `drop policy` line.)

- [ ] **Step 3: Prove staff still read, contractor is blocked, bidding still works (rolled-back sim)**

Via MCP `execute_sql`, run a `begin; … rollback;` block that sets the JWT claim to a staff user and to a contractor org-member (use real seeded ids, or create temp memberships inside the transaction) and asserts:
- staff: `select count(*) from public.boq_items where org_id = :org` > 0 and `budget_rate_cents` is visible.
- contractor org-member: same select returns **0** rows.
- contractor: `select public.tender_bill_lines(:tender)` still returns the bill rows (and the row shape has **no** `budget_rate_cents` column).
- contractor: `select count(*) from public.boq_tenders where org_id = :org` returns only tenders they bid on.

Expected: all four hold. If the contractor still sees `boq_items`, the policy drop/recreate didn't take — re-check Step 2.

- [ ] **Step 4: Add permanent assertions to the RLS test suite**

Append to `supabase/tests/rls_security.sql` a section mirroring Step 3's four checks using the suite's existing helper/fixture style (match the surrounding `set local role` / `set_config('request.jwt.claims', …)` pattern already in that file). Each assertion uses the file's existing failure convention (e.g. `assert`/`raise exception` as used elsewhere in the suite).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ supabase/tests/rls_security.sql
git commit -m "feat(boq): is_org_staff() + restrict BOQ library/tender reads to staff

Contractors (org_role member) could read boq_items incl. PRIVATE budget_rate_cents.
Tighten SELECT policies to is_org_staff; contractors keep tender access via
is_tender_bidder + tender_bill_lines view.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Surface `member_type` in `getActiveContext`

**Files:**
- Modify: `apps/web/lib/data/org.ts` (interface `OrgMembershipSummary` ~23-27; `MembershipQueryRow` ~36-40; `getActiveContext` select + map ~55-65)

- [ ] **Step 1: Import `MemberType` and extend `OrgMembershipSummary`**

At the top of `apps/web/lib/data/org.ts`, add to the existing shared import (or a new line):

```ts
import type { MemberType } from '@datumpro/shared/access';
```

Extend the interface:

```ts
export interface OrgMembershipSummary {
  orgId: string;
  name: string;
  role: OrgRole;
  memberType: MemberType;
}
```

- [ ] **Step 2: Select and map `member_type`**

In `MembershipQueryRow`, add the column:

```ts
type MembershipQueryRow = {
  role: string | null;
  member_type: string | null;
  org_id: string;
  organizations: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
};
```

Change the `.select(...)` in `getActiveContext` to include `member_type`:

```ts
    .select('role, member_type, org_id, organizations(id, name)')
```

And map it (mirroring the `?? 'staff'` coercion used in `org-members.ts`):

```ts
  const memberships: OrgMembershipSummary[] = ((data ?? []) as MembershipQueryRow[]).map((m) => ({
    orgId: m.org_id,
    name: orgName(m),
    role: (m.role ?? 'viewer') as OrgRole,
    memberType: (m.member_type ?? 'staff') as MemberType,
  }));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo run typecheck --filter=@datumpro/web`
Expected: PASS (any consumer constructing `OrgMembershipSummary` literals would error — there should be none besides this map; fix if the compiler flags one).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/data/org.ts
git commit -m "feat(org): surface member_type on active context memberships

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Role-aware nav item

**Files:**
- Modify: `apps/web/components/shell/nav-items.ts` (`computeNav` signature ~33-39, org-level BOQ item ~63)
- Modify: `apps/web/components/shell/sidebar.tsx` (props ~20-31, destructure ~33, `computeNav` call ~39)
- Modify: `apps/web/components/shell/mobile-nav.tsx` (matching props + `computeNav` call ~31)
- Modify: `apps/web/app/(app)/layout.tsx` (pass `memberType` to `<Sidebar>` ~55 and `<MobileNav>` ~68)

- [ ] **Step 1: Add `memberType` param + branch the BOQ item in `computeNav`**

In `nav-items.ts`, import the type:

```ts
import type { MemberType } from '@datumpro/shared/access';
```

Add a trailing parameter to `computeNav`:

```ts
export function computeNav(
  activeProject: SidebarProject | null,
  canManageMembers: boolean,
  canViewFinance = false,
  showMyPayments = true,
  managedProjectIds: string[] = [],
  memberType: MemberType = 'staff',
): NavItem[] {
```

In the org-level `return [...]` array, replace the hard-coded BOQ line
(`{ name: 'BOQ', href: '/boq', icon: FileText },`) with a spread that branches:

```ts
    ...(memberType === 'contractor'
      ? [{ name: 'Tenders', href: '/boq', icon: FileText }]
      : memberType === 'client' || memberType === 'viewer'
        ? []
        : [{ name: 'BOQ', href: '/boq', icon: FileText }]),
```

- [ ] **Step 2: Thread `memberType` through the sidebar**

In `sidebar.tsx`, add `memberType: MemberType;` to `SidebarProps` (import the type from `@datumpro/shared/access`), destructure it in the component signature (default `'staff'`), and pass it as the last arg:

```ts
  const nav = computeNav(activeProject, canManageMembers, canViewFinance, showMyPayments, managedProjectIds, memberType);
```

- [ ] **Step 3: Thread `memberType` through the mobile nav**

Apply the same three changes in `mobile-nav.tsx`: add `memberType: MemberType` to its props (import the type), destructure with default `'staff'`, and pass it as the last arg to its `computeNav(...)` call.

- [ ] **Step 4: Pass `memberType` from the layout**

In `apps/web/app/(app)/layout.tsx`, add `memberType={ctx.active.memberType}` to both `<Sidebar ... />` (after `myTaskCount`) and `<MobileNav ... />` (after `managedProjectIds`).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm turbo run typecheck lint --filter=@datumpro/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shell/nav-items.ts apps/web/components/shell/sidebar.tsx apps/web/components/shell/mobile-nav.tsx "apps/web/app/(app)/layout.tsx"
git commit -m "feat(nav): role-aware BOQ item — staff BOQ, contractor Tenders, hide for client/viewer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Contractor portal + `/boq` page branch

**Files:**
- Modify: `apps/web/lib/data/tender.ts` (add `listMyTenderInvites` + its return type)
- Create: `apps/web/app/(app)/boq/contractor-portal.tsx`
- Modify: `apps/web/app/(app)/boq/page.tsx` (branch on `memberType`)

- [ ] **Step 1: Add the portal data function**

In `apps/web/lib/data/tender.ts`, add an exported type and function. It reads the
caller's own bidder rows (RLS `boq_bidders_self_read`) joined to their tenders
(`boq_tenders_select` via `is_tender_bidder`):

```ts
export interface MyTenderInvite {
  bidderId: string;
  inviteToken: string;
  bidderStatus: 'invited' | 'viewing' | 'submitted' | 'withdrawn';
  tenderId: string;
  title: string;
  closeAt: string | null;
  tenderStatus: TenderStatus;
  awardedToMe: boolean;
  tenderAwarded: boolean;
}

export async function listMyTenderInvites(userId: string): Promise<MyTenderInvite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boq_bidders')
    .select(
      'id, invite_token, status, tender_id, ' +
        'boq_tenders(id, title, close_at, status, awarded_bidder_id)',
    )
    .eq('user_id', userId)
    .neq('status', 'withdrawn');

  type Row = {
    id: string;
    invite_token: string;
    status: MyTenderInvite['bidderStatus'];
    tender_id: string;
    boq_tenders:
      | { id: string; title: string; close_at: string | null; status: TenderStatus; awarded_bidder_id: string | null }
      | { id: string; title: string; close_at: string | null; status: TenderStatus; awarded_bidder_id: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const t = Array.isArray(r.boq_tenders) ? r.boq_tenders[0] : r.boq_tenders;
      if (!t) return null;
      return {
        bidderId: r.id,
        inviteToken: r.invite_token,
        bidderStatus: r.status,
        tenderId: t.id,
        title: t.title,
        closeAt: t.close_at,
        tenderStatus: t.status,
        awardedToMe: t.awarded_bidder_id === r.id,
        tenderAwarded: t.status === 'awarded',
      } as MyTenderInvite;
    })
    .filter((x): x is MyTenderInvite => x !== null);
}
```

Note: confirm `TenderStatus` and `createClient` are already imported/declared in
`tender.ts` (they are — used by the existing functions). Reuse them.

- [ ] **Step 2: Build the portal component**

Create `apps/web/app/(app)/boq/contractor-portal.tsx`. It's a server component (no
client interactivity needed — plain links). Match the visual idiom of the existing
`/boq` library table (borders, `text-sm`, zinc palette) and reuse `Badge`, `Button`,
`EmptyState`, `PageContainer`:

```tsx
import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText } from '@/components/icons';
import type { MyTenderInvite } from '@/lib/data/tender';

function fmtDate(iso: string | null): string {
  if (!iso) return 'No deadline';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ContractorTenderPortal({ invites, orgName }: { invites: MyTenderInvite[]; orgName: string }) {
  return (
    <PageContainer width="5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tenders</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Tenders you&apos;ve been invited to price for{' '}
          <span className="font-medium text-brand-600 dark:text-brand-500">{orgName}</span>.
        </p>
      </div>

      {invites.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={FileText}
            title="No tenders yet"
            hint="When a client invites you to price a bill of quantities, it will appear here."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2.5 font-semibold">Tender</th>
                <th className="px-4 py-2.5 font-semibold">Closes</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const canPrice =
                  !inv.tenderAwarded && (inv.bidderStatus === 'invited' || inv.bidderStatus === 'viewing');
                const statusBadge = inv.awardedToMe ? (
                  <Badge tone="green">Awarded ✓</Badge>
                ) : inv.tenderAwarded ? (
                  <Badge tone="faint">Closed</Badge>
                ) : inv.bidderStatus === 'submitted' ? (
                  <Badge tone="blue">Submitted</Badge>
                ) : (
                  <Badge tone="amber">To price</Badge>
                );
                return (
                  <tr key={inv.bidderId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-200">{inv.title}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{fmtDate(inv.closeAt)}</td>
                    <td className="px-4 py-2.5">{statusBadge}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/tender/${inv.inviteToken}`}>
                        <Button variant="secondary" size="sm">
                          {canPrice ? 'Price →' : 'View →'}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
```

Note: confirm `PageContainer` accepts `width="5xl"` and `EmptyState`/`Button`/`Badge`
prop shapes by matching their usage in the existing `apps/web/app/(app)/boq/page.tsx`
(they are used there identically). Confirm `Badge` tone `'blue'`/`'faint'` exist (they
do — see `components/ui/badge.tsx`).

- [ ] **Step 3: Branch the `/boq` page on `member_type`**

In `apps/web/app/(app)/boq/page.tsx`, import at top:

```ts
import { notFound } from 'next/navigation';
import { listMyTenderInvites } from '@/lib/data/tender';
import { ContractorTenderPortal } from './contractor-portal';
```

Immediately after the existing `if (!ctx?.active) redirect('/orgs/new');` line, add the
branch (before `const boqs = await listBoqs(...)`):

```ts
  const memberType = ctx.active.memberType;
  if (memberType === 'client' || memberType === 'viewer') notFound();
  if (memberType === 'contractor') {
    const invites = await listMyTenderInvites(ctx.userId);
    return <ContractorTenderPortal invites={invites} orgName={ctx.active.name} />;
  }
```

Everything below (the existing staff library render) stays unchanged and now only runs
for staff types.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm turbo run typecheck lint --filter=@datumpro/web`
Expected: PASS.

- [ ] **Step 5: Manual verification (by inspection + local run if available)**

Confirm the branch logic:
- staff `member_type` → library render (unchanged code path).
- `contractor` → `<ContractorTenderPortal>` with their invites; each row links to
  `/tender/<invite_token>`, `[Price →]` when biddable else `[View →]`, correct status
  badge (Awarded/Closed/Submitted/To price).
- `client`/`viewer` → `notFound()`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/data/tender.ts "apps/web/app/(app)/boq/contractor-portal.tsx" "apps/web/app/(app)/boq/page.tsx"
git commit -m "feat(boq): contractor tender portal + role-branch the /boq page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `is_org_staff` helper → Task 1 Step 1. ✓
- Repoint boqs/sections/items/tenders SELECT policies → Task 1 Step 1. ✓
- Bidding-unaffected proof + RLS assertions → Task 1 Steps 3-4. ✓
- Surface `member_type` on active context → Task 2. ✓
- Nav: staff `BOQ`, contractor `Tenders`, hide client/viewer → Task 3 Step 1. ✓
- Thread memberType through both navs + layout → Task 3 Steps 2-4. ✓
- `/boq` page branch incl. `notFound()` for client/viewer → Task 4 Step 3. ✓
- Portal lists invites, status badges, links to `/tender/[token]` → Task 4 Steps 1-2. ✓
- External email-only bidder flow untouched → no task modifies `/tender/[token]`. ✓

**Placeholder scan:** No TBD/TODO; each code step shows complete code. Migration
timestamp is intentionally resolved at apply time (Task 1 Step 2). ✓

**Type consistency:** `memberType`/`MemberType` used identically across Tasks 2-4;
`OrgMembershipSummary.memberType` (Task 2) is read in layout (Task 3 Step 4) and page
(Task 4 Step 3). `MyTenderInvite` fields defined in Task 4 Step 1 match their use in the
portal (Task 4 Step 2). `is_org_staff(uuid)` signature consistent across all policy
uses. ✓
