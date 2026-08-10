# BOQ tender — flag incomplete bids (design)

**Date:** 2026-08-10
**Status:** Approved, ready for plan.
**Scope:** Piece 1 of 3 in the BOQ role/award programme (the other two —
role-aware `/boq` nav, and award→costed-tasks bridge — are separate specs).

## Goal

A bidder who prices only part of the bill and marks the rest **no-bid** currently
totals artificially low (no-bid lines count as 0) and can land at **rank #1** on a
total that isn't comparable to a fully-priced bid. Make incompleteness **visible**
in the comparison matrix, and guard the award action against awarding a partial bid
by reflex — **flag, do not exclude**.

## Decision (from brainstorming)

- **Rank all bidders, badge incomplete ones, show coverage %.** Ranking stays
  exactly as today (all submitted bidders sorted ascending by total, cheapest =
  rank #1). No re-sorting, no exclusion, no award lock.
- The flag is purely informational + one confirm on award.

## Definitions

For each **submitted** bidder in a tender's comparison:

- `totalLines` = number of `boq_items` in the bill (i.e. `qtyMap.size`).
- `pricedLines` = count of that bidder's `boq_bid_items` rows where
  `no_bid = false` **and** `rate_cents is not null`.
  - A line the bidder never created a bid-item row for counts as **unpriced**
    (not just explicit no-bids). So `pricedLines` counts only genuinely priced lines.
- `coveragePct` = `totalLines > 0 ? pricedLines / totalLines : 1`.
- `isComplete` = `pricedLines === totalLines` (every line priced; zero no-bids;
  none skipped).

## Data layer — `getTenderComparison` (`apps/web/lib/data/tender.ts`)

The four new fields are computed inside the existing step-5 map
(`unsortedBidders`), reusing the `rows`/`qtyMap` already in scope. No new query.

- Extend the `CompareBidder` type (in `apps/web/lib/types/tender.ts` or wherever
  it is declared) with: `pricedLines: number; totalLines: number;
  coveragePct: number; isComplete: boolean;`.
- In the map, while iterating `rows`, increment a `pricedLines` counter when
  `!noBid && row.rate_cents != null`. Set `totalLines = qtyMap.size`. Derive
  `coveragePct` and `isComplete` as defined above. Carry the four fields through
  the sort/rank step (step 6) unchanged.

**No migration.** Pure computation over data already loaded.

## UI — comparison matrix (`apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx`)

Each bidder column header gains a status chip beneath the company name / total:

- `isComplete` → `✓ complete` — subtle/neutral (muted text, no alarm).
- `!isComplete` → `⚠ priced {pricedLines}/{totalLines} ({round(coveragePct*100)}%)`
  — amber warning styling, so a low-total leader visibly reads as *partial*, not
  *cheapest*.

Rank number and ordering are unchanged; the chip sits alongside the existing
rank/total/variance display.

## Award guard — award action (`apps/web/app/(app)/boq/[boqId]/tender/`)

Awarding an **incomplete** bidder triggers a client-side **confirm** before the
existing `awardTender` action runs:

> "{Company} left {n} of {totalLines} lines unpriced. Award anyway?"

where `n = totalLines - pricedLines`. Complete bids award with no extra prompt.
No server-side change to `award_boq_tender` — this is a UI safety touch only
(flag, not gate; award of a partial bid remains permitted).

## Explicitly NOT in this piece (YAGNI)

- No coverage-weighted ranking or re-sorting (a partial #1 stays #1, just badged).
- No server-side award block for incomplete bids.
- No per-line "missing" highlight beyond the existing matrix (the coverage % is
  the summary signal).
- No threshold/tolerance — any unpriced line makes a bid incomplete; the % conveys
  severity.

## Verification

- No DB change → no RLS/migration sim needed.
- `pnpm turbo run typecheck lint` clean.
- Manually reason the coverage math against a seeded bidder: e.g. 12-line bill,
  bidder with 5 priced + 3 explicit no-bid + 4 untouched → `pricedLines = 5`,
  `coveragePct = 42%`, `isComplete = false`; a bidder with all 12 priced →
  `isComplete = true`, chip `✓ complete`.
