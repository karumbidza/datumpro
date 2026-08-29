# Tender Over-Budget Guard + Budget Highlights

**Date:** 2026-08-29
**Status:** Approved (design) — small, self-contained
**Branch:** `feat/tender-guard-highlights` (stacked on `feat/program-of-works-timeline`, since both edit `comparison.tsx`)

## Problem

A contractor fat-fingered bid rates ~1,575× the budget and the tender was awarded without friction (the award confirm shows a variance % but at these magnitudes it's easy to click past). And the comparison matrix colours lines by *rank* (cheapest/dearest), which doesn't flag an insane bid vs the budget.

## Decisions (from brainstorming)

- **B — highlights: versus budget.** green ≤ budget · amber (yellow) ≤ 2× budget · red > 2× budget.
- **A — guard threshold: 2×.** A bid total > 2× budget forces an extra confirm.

## Design (client-only, `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx`)

1. **`budgetTint(amountCents, budgetCents)`** helper → `''` when no budget, else `bg-green-50` (≤1×), `bg-amber-50` (≤2×), `bg-red-50` (>2×) with dark-mode variants. Gentle backgrounds.
2. **B — per-line bidder cells** use `budgetTint(amount, item.budgetAmountCents)` (replacing the old rank-based green/red *text* colouring; the unused min/max computation is removed). **Per-bidder totals** add `budgetTint(bidder.totalCents, budgetTotalCents)` alongside the existing awarded/rank text colour.
3. **A — over-budget guard** in the award `onSubmit` confirm: if `bidder.totalCents > OVER_BUDGET_GUARD_X (=2) × budgetTotalCents`, prepend `⚠ This bid is N× the budget ($X vs $Y) — likely a data-entry error.` to the confirm message.
4. **Legend** in the matrix header explaining the three tints.

## Edge handling
- Lines/totals with zero budget → no tint (nothing to compare).
- No DB/RPC change; no data-flow change; awarding still posts the same form to `awardTender`.

## Testing
Gates: `pnpm -C apps/web typecheck` + `eslint` clean; `next build`. Manual: fat-fingered bid lines glow red; a >2× total shows the extra confirm; a sane bid ≤ budget is green with no extra confirm; legend visible.

## Out of scope
Rank colouring (replaced by budget colouring per the decision), per-line award blocking (guard is a confirm, not a hard block), any server-side validation (client guard only — the point is fat-finger friction, not enforcement).
