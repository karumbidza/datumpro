# BOQ sealed-tender & comparison — design

**Date:** 2026-08-09
**Status:** Approved (phased). Phase 0 shipping first.

## Goal
Evolve the BOQ from a solo priced estimate into a **sealed tender**: multiple
companies price the same bill online, their prices stay hidden from the owner's
team until unsealed, then the owner compares bidders side-by-side and awards one.

## Decisions (from brainstorming)
- **Bid pricing source:** contractors submit **sealed bids online** (not owner-keyed).
- **Bidders:** invite **existing contractor members and/or new companies by email**.
- **Sealing:** **practical soft-seal** — app + RLS hide bid prices from the owner's
  team until `unsealed_at` is set; unseal is audit-logged; bidders never see the
  budget rate or each other's bids. (No cryptographic sealing.)

## Phasing
Each phase is its own plan/implementation.

### Phase 0 — Base BOQ table refinement (SHIP FIRST, small)
The line-item grid in the builder (`apps/web/app/(app)/boq/[boqId]/boq-builder.tsx`)
gets explicit columns, in order:
**Item No · Description · Unit · Qty · Budget/Est (rate) · Total.**
- **Item No** is auto-derived `sectionIndex.itemIndex` (e.g. `1.1, 1.2, 2.1`) —
  display-only, not stored (positions already exist).
- Header renamed to **Budget/Est** for the rate column; **Total** stays.
- No separate item-code column for now (easy to add later).
- Apply the same header/numbering to the import **preview** grid for consistency.

### Phase 1 — Tender engine (bidding side)
New tables:
- `boq_tenders` — one per BOQ put to bid: `id, org_id, boq_id (FK id,org_id),
  title, close_at, status ('draft'|'open'|'closed'|'awarded'|'cancelled'),
  unsealed_at, awarded_bidder_id, created_by, timestamps`.
- `boq_bidders` — invited companies: `id, org_id, tender_id, company_name,
  contact_email, user_id (nullable), invite_token, status
  ('invited'|'viewing'|'submitted'|'withdrawn'), invited_at, submitted_at`.
  Existing contractor member → set `user_id`; new → email invite w/ token → light
  contractor account on accept → link `user_id`.
- `boq_bid_items` — `id, org_id, bidder_id, boq_item_id, rate_cents,
  note (nullable), no_bid boolean default false`; total = owner `qty` × `rate`
  (computed in view/query, since qty lives on `boq_items`). Unique `(bidder_id, boq_item_id)`.

Bidder pricing screen (route e.g. `/tender/[token]` or `/boq/[boqId]/bid`):
the bill (Item No, Description, Unit, **Qty**) + editable **their-rate** column +
optional per-line note / "no-bid" + live totals + submit (revisable until `close_at`).

### Phase 2 — Compare & award (owner side)
- Pre-unseal: owner sees bidder list + submission status only (no prices).
- **Unseal** (audit-logged; allowed once bids in or deadline passed) → matrix:
  base columns **+ one summary column per bidder** (Total, variance vs budget, rank).
- Click a bidder → their **full priced bill** beside the budget, per-line
  cheapest/dearest highlighted.
- **Award** a bidder → tender `awarded`, `awarded_bidder_id` set; all bids preserved.

## Access / RLS (Phase 1–2)
- Owner/staff: read `boq_bidders` + status always; read `boq_bid_items` (prices)
  **only when the tender's `unsealed_at` is set**. Manage tender = admin/PM.
- Bidders: read the tender's lines **via a view that excludes `budget_rate_cents`**
  (RLS is row-level; a projection enforces "never expose the budget rate");
  read/write **only their own** bid (keyed on `auth.uid() = boq_bidders.user_id`),
  writable until submit/`close_at`; no access to other bids or org data.

## Explicitly NOT in v1 (YAGNI)
Cryptographic hard-seal; bidders adding/removing/re-scoping lines (they price the
bill as-is); auto-generating a project/contract from the award (award = mark +
export); multi-round / best-and-final; per-bidder Q&A/addenda.

## Verification
No web test harness — verify via `turbo typecheck lint`, DB-level RLS checks
(simulate owner pre/post-unseal and a bidder under RLS, rolled back), and the
shipped `supabase/tests/rls_security.sql` suite for the new tables.
