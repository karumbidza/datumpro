# Awarded-BOQ lifecycle: lock + "Awarded" status + tender audit trail + org-name heading

**Date:** 2026-08-30
**Status:** Approved (design)
**Branch:** `feat/awarded-boq-audit-lifecycle`

## Goal

Once a BOQ's tender is awarded: lock the BOQ from editing, show "Awarded" in the Bills & tenders list, and give managers a read-only **tender audit trail** (all contractors' bids with the winner highlighted, plus who was invited / who participated / when). Also: make the dashboard heading show the **organisation name** (not the username), so a multi-account tester always knows which org they're in. No migration — all data already exists.

## A — Lock an awarded BOQ

`apps/web/app/(app)/boq/[boqId]/page.tsx`: `getBoqDetail` already returns `boq.tenderStatus`. Change the edit gate to also require the tender isn't awarded:
```ts
const canEdit = ['owner', 'admin', 'pm'].includes(ctx.active.role) && boq.tenderStatus !== 'awarded';
```
The builder (`boq-builder.tsx`) already guards every mutation on `canEdit`, so it goes fully read-only. Add a small locked banner in the builder (shown when the BOQ is awarded, i.e. `boq.tenderStatus === 'awarded'`): *"This bill has been awarded — it's locked. View the tender audit →"* linking to `/boq/{id}/tender`. Pass a `locked`/`tenderAwarded` boolean to the builder (or read `boq.tenderStatus` it already receives).

## B — "Awarded" status in the Bills & tenders list

`apps/web/lib/data/boq.ts` `listBoqs`: the query already embeds `boq_tenders(status, created_at)` but drops it. Return the **latest live tender's status** as `tenderStatus: TenderStatus | null` on `BoqListRow` (pick the newest tender by `created_at`; live = the same filter `getBoqDetail` uses). `apps/web/app/(app)/boq/page.tsx` list: render a **tender badge** (`TENDER_STATUS_LABELS` + `TENDER_STATUS_TONE`) next to the BOQ status badge when `tenderStatus` is set — so an awarded bill reads **Awarded** (and out-to-tender bills read "Out to tender", etc.).

## C — Tender audit trail (read-only, no migration)

The tender page (`apps/web/app/(app)/boq/[boqId]/tender/page.tsx`) already renders, for an unsealed/awarded tender, the budget total + the full **comparison matrix with the winner highlighted** (`comparison.tsx`) — that IS "all contractors' bids, winner highlighted". Additions:

1. **Audit panel component** `apps/web/app/(app)/boq/[boqId]/tender/tender-audit.tsx` — a read-only table of every invited bidder:
   - Columns: **Contractor** (company / email) · **Status** (Invited / Viewing / Submitted / Withdrawn / **Won 🏆**) · **Invited** (`invited_at`) · **Submitted** (`submitted_at` or —) · **Participated?** (submitted → ✓; invited-but-never-submitted at a closed/awarded tender → ✗ "Did not participate"; withdrawn → "Withdrew").
   - The winner (`awarded_bidder_id`) row highlighted green with a 🏆.
   - Timestamps rendered via the existing `LocalDateTime` component (viewer's TZ).
   - Props: `{ bidders: AuditBidder[]; awardedBidderId: string | null }` where `AuditBidder = { id, companyName, contactEmail, status, invitedAt, submittedAt }`.
2. **Data**: extend `getTenderForOwner`'s bidder select to include `invited_at` (add to the select + the `BidderDbRow` type + the returned `bidders`, as `invitedAt`). All other fields already returned. (Per-view/withdrawal timestamps would need a schema change — out of scope for v1; participation audit works from status + invited/submitted times.)
3. **Placement**: render `<TenderAudit …>` on the tender page for managers when the tender is unsealed/awarded, above the `<Comparison>` matrix (collapsible or a titled section "Tender audit").
4. **Link from the locked BOQ** (A's banner) points to `/boq/{id}/tender`, which now shows audit + comparison.

## D — Dashboard heading shows the org name

`apps/web/app/(app)/dashboard/page.tsx`: the `Greeting` currently takes `name={displayName}` (the user). Change all three persona branches to `name={active.name}` (the org name). Keep the subtitle informative and non-duplicative:
- portfolio: subtitle was `${org} · ${date}` → change to `${displayName} · ${date}` (show the person + date under the org) — or just the date; use the person's name so it's not lost.
- delivery: `Delivery overview · ${date}` (unchanged; add the person's name if desired).
- personal: `Your work · ${date}` (unchanged).
Simplest consistent rule: **heading = org name; subtitle = `${displayName} · ${persona-or-Your work} · ${date}`** so both org and person are visible, org dominant. (Pairs with the sidebar org·role chip already shipped.)

## Error / edge handling
- BOQ with no tender or a non-awarded tender → editable as before (only `awarded` locks).
- List rows with no tender → no tender badge (just the BOQ status).
- Audit with a bidder that never had `invited_at` (shouldn't happen) → show "—".
- Awarded tender viewed by a non-manager contractor → they still reach the bidder's own view (unchanged); the audit panel is manager-only.

## Testing
No unit harness for these components. Gates: `pnpm -C apps/web typecheck` + `eslint`; full `next build`. Manual: award a tender → the BOQ builder is read-only with a locked banner + audit link; the Bills list shows "Awarded"; the tender page shows the audit table (winner 🏆, participation, times in local TZ) above the comparison; the dashboard heading shows the org name.

## Out of scope
- Per-view / withdrawal timestamp capture (schema change). Unlocking an awarded BOQ (managers use variations on the delivery side). Any change to the comparison matrix itself (already highlights the winner). Making the three dashboards pixel-identical (only the heading changes here).
