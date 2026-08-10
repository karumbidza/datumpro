# Role-aware `/boq` (staff library vs contractor tender portal) — design

**Date:** 2026-08-10
**Status:** Approved, ready for plan.
**Scope:** Piece 2 of 3 in the BOQ role/award programme. (Piece 1 — flag incomplete
bids — shipped. Piece 3 — award→costed-tasks bridge — is a separate spec.)

## Goal

`/boq` is currently shown to **every** org member and renders the BOQ library to all
of them. Two problems:

1. **UX:** a contractor has no business in the BOQ *library* (create/upload/approve
   BOQs). They should see the tenders they're invited to price, and their status.
2. **Confidentiality (real leak):** the `boqs` / `boq_sections` / `boq_items` SELECT
   policies are `is_org_member(org_id)`. A contractor is an org member
   (`member_type=contractor` → `org_role=member`), so a contractor can currently read
   the whole BOQ library **including `budget_rate_cents`** — the internal estimate the
   schema comment calls "PRIVATE to staff." The tender flow protects that rate from
   *external* bidders (via the `tender_bill_lines` view + bidders not being org
   members), but an org-member contractor bypasses it with a direct query.

Make `/boq` **role-aware and enforced**: staff get the library; contractors get a
tender portal and are blocked at the DB from reading the library or budget rates;
clients/viewers get no BOQ access at all.

## Audience note

The contractor portal serves **org-member contractors** (`member_type=contractor`).
Pure external email-only bidders are **not** org members, never see the app shell, and
keep using the tokenised `/tender/[token]` link from their invite email — that flow is
**unchanged**. This piece adds (a) the in-app portal for org-member contractors and
(b) the RLS tightening.

## Decisions (from brainstorming)

- **Scope:** both the UX split **and** the RLS confidentiality fix.
- **Route shape:** one `/boq` route that **branches server-side on `member_type`** (no
  redirects, no second route). "Same nav item, different function."
- **Pricing entry:** the portal links to the **existing `/tender/[token]` screen**
  (using the `invite_token` on the contractor's own bidder row). No new pricing UI.
- **Nav label:** contractor's nav item is relabeled **`Tenders`** (still → `/boq`);
  staff keep **`BOQ`**; client/viewer see **no** BOQ item.
- **Client/viewer:** no BOQ access — nav item hidden **and** `/boq` returns `notFound()`
  on a direct hit.

## Role → BOQ behaviour matrix

| `member_type`            | Nav item        | `/boq` renders            | Reads BOQ library / budget rates |
|--------------------------|-----------------|---------------------------|----------------------------------|
| owner / admin / pm / staff | `BOQ`         | existing library          | ✓ (staff)                        |
| contractor               | `Tenders`       | contractor tender portal  | ✗ (RLS-blocked; prices via view) |
| client / viewer          | *(hidden)*      | `notFound()`              | ✗                                |

"Staff" = `member_type in ('owner','admin','pm','staff')`.

## Part B — DB: `is_org_staff` helper + RLS tightening

**New helper** (modelled exactly on `is_org_member` in `20260101000000_init_tenancy.sql`):

```sql
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
```

**Repointed SELECT policies** (drop + recreate; WRITE policies unchanged — already
admin/pm):
- `boqs_select`, `boq_sections_select`, `boq_items_select` (from `20260101008200`):
  `using (is_org_member(org_id))` → `using (is_org_staff(org_id))`.
- `boq_tenders_select` (from `20260101008500`): `using (is_org_member(org_id) or
  is_tender_bidder(id))` → `using (is_org_staff(org_id) or is_tender_bidder(id))`, so a
  contractor sees only tenders they're a bidder on, not every org tender.

**Why bidding is unaffected:** the contractor pricing path never depends on the library
SELECT policies —
- the bill is read via `tender_bill_lines()` (SECURITY DEFINER; already excludes
  `budget_rate_cents`),
- bid read/write is governed by `boq_bid_items` self-policies (keyed on `user_id`),
- the bidder's own `boq_bidders` row is readable via `boq_bidders_self_read`.
All of these bypass or are independent of `boqs/boq_items` RLS.

Migration file: next `20260101008xxx` timestamp (e.g. `20260101008700_is_org_staff.sql`).
Apply via Supabase MCP `apply_migration` (get a real timestamped version).

## Part A — App: surface `member_type`, branch nav + page

**Surface member_type** (`apps/web/lib/data/org.ts`):
- Add `memberType: MemberType` to `OrgMembershipSummary` (import `MemberType` from
  `@datumpro/shared`).
- In `getActiveContext`, add `member_type` to the `org_members` select and map it onto
  each membership (default `'staff'` when absent, mirroring the DB column default).

**Nav** (`apps/web/components/shell/nav-items.ts` + callers):
- `computeNav` gains a trailing `memberType: MemberType = 'staff'` parameter. In the
  org-level branch, replace the hard-coded BOQ item with:
  - staff types → `{ name: 'BOQ', href: '/boq', icon: FileText }`
  - `contractor` → `{ name: 'Tenders', href: '/boq', icon: FileText }`
  - `client` / `viewer` → omit the item.
- `apps/web/app/(app)/layout.tsx` passes `memberType={ctx.active.memberType}` to both
  `<Sidebar>` and `<MobileNav>`; each threads it into its `computeNav(...)` call.
  (`sidebar.tsx` and `mobile-nav.tsx` gain a `memberType` prop.)

**Page branch** (`apps/web/app/(app)/boq/page.tsx`):
- After resolving `ctx.active`, branch on `ctx.active.memberType`:
  - staff types → existing library render (unchanged).
  - `contractor` → render `<ContractorTenderPortal invites={...} />`.
  - `client` / `viewer` → `notFound()`.

**Portal data** (`apps/web/lib/data/tender.ts`, new `listMyTenderInvites(userId)`):
- Query `boq_bidders` where `user_id = userId` and `status <> 'withdrawn'`, selecting
  `id, invite_token, status, submitted_at` and the joined tender
  `boq_tenders(id, title, close_at, status, awarded_bidder_id)`.
- Return a typed list; RLS (`boq_bidders_self_read` + `boq_tenders_select` via
  `is_tender_bidder`) already scopes it to the caller.

**Portal UI** (`apps/web/app/(app)/boq/contractor-portal.tsx`, new client/server
component): a table of the caller's tenders — title, close date, and a status-driven
action:
- bidder `status in ('invited','viewing')` and tender open → `[Price →]` linking to
  `/tender/{invite_token}`.
- bidder `status = 'submitted'` → `[View →]` (same link; the screen is read-only after
  submit).
- tender `awarded_bidder_id === this bidder id` → `Awarded ✓` badge.
- tender awarded to someone else / closed → `Closed` badge.
- empty state when the contractor has no invites.

## Explicitly NOT in this piece (YAGNI)

- No token-free in-app pricing route (reuse `/tender/[token]`).
- No changes to the external email-only bidder flow.
- No new BOQ *library* features for staff (unchanged).
- No project/task generation on award — that's Piece 3.

## Verification

- **RLS sim (rolled back, via MCP `execute_sql`):** as a staff member, `select` on
  `boq_items` returns rows incl. `budget_rate_cents`; as a contractor org-member, the
  same `select` returns **zero** rows, yet `tender_bill_lines(tender)` still returns the
  bill (no budget rate) and the contractor can still read/write their `boq_bid_items`.
  Also: contractor `select` on `boq_tenders` returns only tenders they bid on.
- Add these as permanent assertions to `supabase/tests/rls_security.sql`.
- `pnpm turbo run typecheck lint --filter=@datumpro/web` clean.
- Manual: staff nav shows `BOQ`→library; a seeded contractor org-member sees
  `Tenders`→portal; client/viewer see no item and `/boq` 404s.
