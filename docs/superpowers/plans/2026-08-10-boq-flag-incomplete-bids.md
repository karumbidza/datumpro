# Flag Incomplete Bids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make partially-priced (no-bid) tender bids visibly flagged in the comparison matrix with a coverage %, and guard the award button against awarding an incomplete bid by reflex.

**Architecture:** Pure computation over data `getTenderComparison` already loads — add four fields (`pricedLines`, `totalLines`, `coveragePct`, `isComplete`) to the `CompareBidder` type and compute them in the existing step-5 map. Render a status chip per bidder column header in `comparison.tsx`, and make the existing award-form `confirm()` message conditional on completeness. No database change, no new query.

**Tech Stack:** Next.js App Router (server component data layer + client comparison component), TypeScript. Verification via `pnpm turbo run typecheck lint` (this repo has **no** JS test harness) plus explicit manual reasoning steps.

**Spec:** `docs/superpowers/specs/2026-08-10-boq-flag-incomplete-bids-design.md`

---

### Task 1: Compute coverage in the data layer

**Files:**
- Modify: `apps/web/lib/data/tender.ts:259-267` (the `CompareBidder` interface)
- Modify: `apps/web/lib/data/tender.ts:405-421` (the `unsortedBidders` map inside `getTenderComparison`)

Context: `getTenderComparison` loads the bill into `qtyMap` (a `Map<itemId, qty>` whose `.size` is the number of bill lines) and each submitted bidder's `boq_bid_items` rows into `bidItemsByBidder`. Step 5 maps each bidder to a `CompareBidder`. We add coverage there — no new query, reusing `rows` and `qtyMap` already in scope.

- [ ] **Step 1: Extend the `CompareBidder` interface**

In `apps/web/lib/data/tender.ts`, change the interface (currently lines 259-267) to add the four coverage fields:

```ts
export interface CompareBidder {
  bidderId: string;
  companyName: string;
  totalCents: number;
  varianceCents: number;
  variancePct: number;
  rank: number;
  pricedLines: number;
  totalLines: number;
  coveragePct: number;
  isComplete: boolean;
  rates: Record<string, { rateCents: number; amountCents: number; noBid: boolean }>;
}
```

- [ ] **Step 2: Compute coverage in the step-5 map**

Replace the `unsortedBidders` map body (currently lines 406-421) with this version. It counts a line as **priced** only when the bidder has a bid-item row that is not a no-bid and has a non-null `rate_cents`; untouched lines (no row) are therefore unpriced. `totalLines` is the number of bill lines (`qtyMap.size`).

```ts
  const totalLines = qtyMap.size;
  const unsortedBidders: Omit<CompareBidder, 'rank'>[] = biddersData.map((bd) => {
    const rows = bidItemsByBidder.get(bd.id) ?? [];
    const rates: CompareBidder['rates'] = {};
    let totalCents = 0;
    let pricedLines = 0;
    for (const row of rows) {
      const noBid = !!row.no_bid;
      const rateCents = n(row.rate_cents);
      const qty = qtyMap.get(row.boq_item_id) ?? 0;
      const amountCents = noBid ? 0 : Math.round(qty * rateCents);
      rates[row.boq_item_id] = { rateCents, amountCents, noBid };
      totalCents += amountCents;
      if (!noBid && row.rate_cents != null) pricedLines += 1;
    }
    const varianceCents = totalCents - budgetTotalCents;
    const variancePct = budgetTotalCents > 0 ? varianceCents / budgetTotalCents : 0;
    const coveragePct = totalLines > 0 ? pricedLines / totalLines : 1;
    const isComplete = pricedLines === totalLines;
    return {
      bidderId: bd.id,
      companyName: bd.company_name,
      totalCents,
      varianceCents,
      variancePct,
      pricedLines,
      totalLines,
      coveragePct,
      isComplete,
      rates,
    };
  });
```

Note: `row.rate_cents` is the raw DB value (`number | string | null`) on the `BidItemRow` type — check it for `!= null` **before** it is coerced by `n()`, exactly as written above (`n()` would turn null into 0 and lose the distinction).

- [ ] **Step 3: Verify the type flows through sort/rank unchanged**

The step-6 sort/rank (lines ~424-427) spreads `...bd` and adds `rank`, so the four new fields carry through automatically. Confirm no other construction of a `CompareBidder` literal exists that would now be missing fields:

Run: `grep -rn "companyName:" apps/web/lib/data/tender.ts`
Expected: only the one object literal inside `getTenderComparison` (the one edited in Step 2). If any other literal builds a `CompareBidder`, add the four fields there too.

- [ ] **Step 4: Typecheck**

Run: `pnpm turbo run typecheck --filter=web`
Expected: PASS. If `comparison.tsx` errors because it reads a field not yet present, that's fine to fix in Task 2 — but the data-layer file itself must typecheck. (If the monorepo filter name differs, run `pnpm turbo run typecheck` from repo root.)

- [ ] **Step 5: Manually verify the coverage math**

Reason through a 12-line bill with a bidder holding 5 priced rows + 3 explicit `no_bid` rows + 4 untouched (no row):
- `pricedLines` = 5, `totalLines` = 12, `coveragePct` = `5/12 ≈ 0.4167`, `isComplete` = false.
- A bidder with all 12 priced (no no-bids): `pricedLines` = 12, `coveragePct` = 1, `isComplete` = true.

Confirm the code produces these by inspection (no runtime test harness exists).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/data/tender.ts
git commit -m "feat(boq): compute bid coverage (priced/total lines) in tender comparison

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Show the coverage chip + guard the award confirm

**Files:**
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx:76-139` (bidder column header + award form)

Context: Each submitted bidder renders a `<th>` header (lines 82-137) showing company name, a rank `Badge`, total, and variance, plus an award `<form>` whose `onSubmit` runs a `window.confirm`. `Badge` is imported from `@/components/ui/badge` and supports `tone="green"` and `tone="amber"` (both already defined in `components/ui/badge.tsx`). We add a completeness chip and make the confirm message conditional.

- [ ] **Step 1: Add the completeness chip to the header**

Inside the bidder `.map` (currently starting line 76), after `const showAwardForm = ...` (line 80), add:

```tsx
                const unpricedCount = bidder.totalLines - bidder.pricedLines;
```

Then, in the header's first flex row (the `<div className="flex items-center gap-1.5 flex-wrap">` at lines 90-100), add a chip after the `{isAwarded && ...}` block, before the closing `</div>` at line 100:

```tsx
                        {bidder.isComplete ? (
                          <Badge tone="green">✓ complete</Badge>
                        ) : (
                          <Badge tone="amber">
                            ⚠ priced {bidder.pricedLines}/{bidder.totalLines} (
                            {Math.round(bidder.coveragePct * 100)}%)
                          </Badge>
                        )}
```

- [ ] **Step 2: Make the award confirm conditional on completeness**

Replace the award form's `onSubmit` handler (lines 118-126) so an incomplete bid warns about unpriced lines:

```tsx
                          onSubmit={(e) => {
                            const message = bidder.isComplete
                              ? `Award this tender to ${bidder.companyName}? All bidders will be notified.`
                              : `${bidder.companyName} left ${unpricedCount} of ${bidder.totalLines} lines unpriced. Award anyway? All bidders will be notified.`;
                            if (!window.confirm(message)) {
                              e.preventDefault();
                            }
                          }}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm turbo run typecheck lint --filter=web`
Expected: PASS (from repo root if the filter name differs: `pnpm turbo run typecheck lint`).

- [ ] **Step 4: Manually verify the rendering logic**

By inspection confirm:
- A complete bidder shows a green `✓ complete` chip and the plain award confirm.
- An incomplete bidder (e.g. 5/12) shows an amber `⚠ priced 5/12 (42%)` chip, and awarding pops `"{Company} left 7 of 12 lines unpriced. Award anyway? ..."` (`unpricedCount` = 12 − 5 = 7).
- Rank badge, total, variance, and row highlighting are unchanged.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx"
git commit -m "feat(boq): flag incomplete bids in comparison matrix + guard award confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Coverage metric (priced/total, untouched = unpriced) → Task 1 Step 2. ✓
- `isComplete = pricedLines === totalLines` → Task 1 Step 2. ✓
- Ranking unchanged → Task 1 Step 3 confirms sort/rank untouched. ✓
- Amber `⚠ priced X/Y (Z%)` chip + green `✓ complete` → Task 2 Step 1. ✓
- Award-anyway confirm for incomplete bids → Task 2 Step 2. ✓
- No migration → no DB task present. ✓
- Verification via typecheck/lint + manual reasoning → Task 1 Steps 4-5, Task 2 Steps 3-4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `pricedLines`, `totalLines`, `coveragePct`, `isComplete` named identically in the interface (Task 1 Step 1), the computation (Task 1 Step 2), and the UI (Task 2 Steps 1-2). `unpricedCount` defined in Task 2 Step 1 and used in Step 2. ✓
