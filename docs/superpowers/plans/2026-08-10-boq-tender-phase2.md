# BOQ Sealed Tender — Phase 2 (Unseal · Compare · Award) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After bids are in, let staff unseal a tender (gated: all invited bidders submitted OR deadline passed), compare bidders side-by-side against the budget, drill into any bidder's full priced bill, and award a winner (notifying all bidders).

**Architecture:** Two new SECURITY DEFINER RPCs (`unseal_tender`, `award_tender`) + one eligibility helper (`tender_unseal_eligible`); no new tables and no new RLS (Phase 1 already gates staff price-reads on `boq_tenders.unsealed_at`). A new `getTenderComparison` data function assembles the matrix (base bill + each bidder's rates → totals, variance vs budget, rank). Owner UI gains an Unseal button, the comparison matrix with per-bidder drill-in, and Award (which sends win/regret emails via Resend, best-effort).

**Tech Stack:** Next.js App Router (server components + actions), Supabase Postgres + RLS, `@supabase/ssr`, Resend (`apps/web/lib/email/resend.ts`), audit via `apps/web/lib/audit.ts`.

**Verification reality:** No JS test runner. Verify via SQL assertions in `supabase/tests/rls_security.sql`, `pnpm turbo run typecheck lint`, and rolled-back RPC-path DB simulations via the Supabase MCP.

**Reference patterns (read first):**
- `supabase/migrations/20260101008500_boq_tender_rls.sql` — the Phase 1 RPC style (SECURITY DEFINER, `set search_path=''`, staff-auth check `is_org_admin(v_org) or org_role(v_org)='pm'`, revoke/grant).
- `apps/web/lib/data/tender.ts` — data-layer conventions (`n()` coercion, typed rows, section grouping); has the `// Phase 2: listBidderTotals` stub to replace.
- `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` — `requireOrg()`, `isRedirect()`, best-effort email, error-checked writes.
- `apps/web/app/(app)/boq/[boqId]/tender/bidders-panel.tsx` + `page.tsx` — owner UI patterns.
- `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` — the section/item grid + `fmtMoney` (`apps/web/lib/money.ts`).
- `apps/web/lib/email/tender-invite.ts` + `apps/web/lib/audit.ts` (`logAudit`).

---

## File Structure

**Create:**
- `supabase/migrations/20260101008600_boq_tender_award.sql` — `tender_unseal_eligible`, `unseal_tender`, `award_tender`.
- `apps/web/lib/email/tender-award.ts` — `awardWinEmail`, `awardRegretEmail` builders.
- `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx` — client: matrix + drill-in + award buttons.

**Modify:**
- `apps/web/lib/data/tender.ts` — add `getTenderComparison`; add `unsealEligible` + `unsealedAt` to what the page needs.
- `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` — add `unsealTender`, `awardTender`.
- `apps/web/app/(app)/boq/[boqId]/tender/page.tsx` — show Unseal button (when eligible & sealed) and the comparison (when unsealed).
- `supabase/tests/rls_security.sql` — append unseal-gate + award-auth assertions.

---

## Task 1: Unseal + Award RPCs

**Files:** Create `supabase/migrations/20260101008600_boq_tender_award.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ sealed tender (Phase 2: unseal + award)
-- No new tables/RLS: staff price-reads are already gated on unsealed_at.
-- ─────────────────────────────────────────────────────────────────────────────

-- Eligible to unseal when at least one bid is in AND either every non-withdrawn
-- bidder has submitted, or the deadline has passed. SECURITY DEFINER so the UI
-- can call it to enable/disable the button regardless of the staff RLS path.
create or replace function public.tender_unseal_eligible(p_tender_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with b as (
    select status from public.boq_bidders
    where tender_id = p_tender_id and status <> 'withdrawn'
  ),
  t as (select close_at from public.boq_tenders where id = p_tender_id)
  select
    (select count(*) from b where status = 'submitted') >= 1
    and (
      (select count(*) from b where status <> 'submitted') = 0
      or ((select close_at from t) is not null and (select close_at from t) < now())
    );
$$;
revoke all on function public.tender_unseal_eligible(uuid) from public;
grant execute on function public.tender_unseal_eligible(uuid) to authenticated;

-- Unseal: staff only; re-checks the eligibility gate server-side; idempotent
-- (no-op if already unsealed). Returns the unsealed_at timestamp.
create or replace function public.unseal_tender(p_tender_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_when timestamptz; v_existing timestamptz;
begin
  select org_id, unsealed_at into v_org, v_existing from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_existing is not null then return v_existing; end if;      -- already unsealed
  if not public.tender_unseal_eligible(p_tender_id) then
    raise exception 'tender is not yet eligible to unseal (all bidders must submit, or the deadline must pass)';
  end if;
  v_when := now();
  update public.boq_tenders set status = 'closed', unsealed_at = v_when, updated_at = now()
    where id = p_tender_id;
  return v_when;
end; $$;
revoke all on function public.unseal_tender(uuid) from public;
grant execute on function public.unseal_tender(uuid) to authenticated;

-- Award: staff only; tender must be unsealed; the bidder must belong to the
-- tender and have submitted. Sets status 'awarded' + awarded_bidder_id.
create or replace function public.award_tender(p_tender_id uuid, p_bidder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_sealed timestamptz; v_bidder_ok boolean;
begin
  select org_id, unsealed_at into v_org, v_sealed from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_sealed is null then raise exception 'unseal the tender before awarding'; end if;
  select exists (
    select 1 from public.boq_bidders
    where id = p_bidder_id and tender_id = p_tender_id and status = 'submitted'
  ) into v_bidder_ok;
  if not v_bidder_ok then raise exception 'that bidder is not a submitted bidder on this tender'; end if;
  update public.boq_tenders
    set status = 'awarded', awarded_bidder_id = p_bidder_id, updated_at = now()
    where id = p_tender_id;
end; $$;
revoke all on function public.award_tender(uuid, uuid) from public;
grant execute on function public.award_tender(uuid, uuid) to authenticated;
```

- [ ] **Step 2: (Controller applies to prod; do NOT apply in the subagent.)** Subagent writes the file only.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101008600_boq_tender_award.sql
git commit -m "feat(tender): Phase 2 RPCs — unseal_tender (gated), award_tender, tender_unseal_eligible"
```

---

## Task 2: RLS / RPC regression assertions

**Files:** Modify `supabase/tests/rls_security.sql` (append; reuse the Phase-1 tender fixtures already added there)

- [ ] **Step 1: Append assertions** (match the file's `do $$ … assert … $$;` idiom, rolled back):
  1. **Unseal gate — blocked early:** with two non-withdrawn bidders where only one is 'submitted' and `close_at` in the future, `tender_unseal_eligible(t)` is FALSE, and calling `unseal_tender(t)` raises.
  2. **Unseal gate — all submitted:** set both bidders 'submitted' → `tender_unseal_eligible(t)` TRUE; `unseal_tender(t)` sets `unsealed_at` and returns non-null; a second call is idempotent (returns the same timestamp, no error).
  3. **Unseal gate — deadline path:** one bidder 'submitted', one 'viewing', but `close_at` in the past → eligible TRUE.
  4. **Award requires unseal:** on a sealed tender, `award_tender(t, bidder)` raises 'unseal the tender before awarding'; after unseal, awarding a submitted bidder sets `status='awarded'` + `awarded_bidder_id`; awarding a non-submitted / foreign bidder raises.
  5. **Staff price-read after unseal** (already covered by Phase 1 assertion 1 — leave as is; do not duplicate).

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/rls_security.sql
git commit -m "test(tender): Phase 2 assertions — unseal gate (early/all/deadline), award requires unseal + valid bidder"
```

---

## Task 3: Comparison data layer

**Files:** Modify `apps/web/lib/data/tender.ts` (replace the `// Phase 2` stub)

- [ ] **Step 1: Add types + `getTenderComparison`** (mirror the `n()` + typed-row + grouping conventions already in the file):

```ts
export interface CompareLine {
  itemId: string;
  description: string;
  uom: string | null;
  qty: number;
  budgetRateCents: number;
  budgetAmountCents: number;      // qty * budgetRate
}
export interface CompareSection { sectionId: string; name: string; items: CompareLine[]; }
export interface CompareBidder {
  bidderId: string;
  companyName: string;
  totalCents: number;             // sum(qty * theirRate), no_bid lines excluded
  varianceCents: number;          // totalCents - budgetTotalCents
  variancePct: number;            // varianceCents / budgetTotalCents (0 when budget 0)
  rank: number;                   // 1 = lowest total
  rates: Record<string, { rateCents: number; amountCents: number; noBid: boolean }>; // by itemId
}
export interface TenderComparison {
  tenderId: string;
  title: string;
  status: TenderStatus;
  awardedBidderId: string | null;
  budgetTotalCents: number;
  sections: CompareSection[];
  bidders: CompareBidder[];       // ranked, cheapest first
  currency: string;
}
```

`getTenderComparison(orgId: string, boqId: string): Promise<TenderComparison | null>`:
1. Load the latest tender for the boq (`id, title, status, unsealed_at, awarded_bidder_id, boq_id`). If none or `unsealed_at` is null → return null (comparison is post-unseal only).
2. Load the bill: query `boqs` → `boq_sections(id,name,position, boq_items(id,description,uom,qty,budget_rate_cents,position))` for `boq_id`+`org_id` (mirror `getBoqDetail`). Also read the boq `currency`. Build `sections` with `budgetAmountCents = round(qty*budgetRate)`. Compute `budgetTotalCents`.
3. Load submitted bidders: `from('boq_bidders').select('id, company_name').eq('tender_id', t.id).eq('status','submitted')`.
4. Load their bid items (RLS returns them now that unsealed): `from('boq_bid_items').select('bidder_id, boq_item_id, rate_cents, no_bid').in('bidder_id', <ids>)`. Build each bidder's `rates` map + `totalCents = Σ round(qty*rate)` over the bill items (skip `no_bid`). Then `varianceCents`, `variancePct`, and `rank` (sort by totalCents asc; ties share sort order, rank by index+1).
5. Return the assembled object (bidders sorted cheapest-first).

- [ ] **Step 2: Add `unsealEligible` read for the dashboard.** Add `getTenderOwnerExtras(tenderId: string): Promise<{ unsealEligible: boolean }>` calling `supabase.rpc('tender_unseal_eligible', { p_tender_id: tenderId })` → `{ unsealEligible: !!data }`. (Keep `getTenderForOwner` returning `unsealedAt` — it already does.)

- [ ] **Step 3: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add apps/web/lib/data/tender.ts
git commit -m "feat(tender): comparison data — ranked bidder totals, variance vs budget, per-line rates"
```

---

## Task 4: Award emails

**Files:** Create `apps/web/lib/email/tender-award.ts`

- [ ] **Step 1:** Export two builders mirroring `tender-invite.ts` markup:

```ts
export function awardWinEmail(input: { orgName: string; tenderTitle: string; companyName: string }): { subject: string; html: string }
export function awardRegretEmail(input: { orgName: string; tenderTitle: string; companyName: string }): { subject: string; html: string }
```
Win subject: `You've been awarded: <tenderTitle>`. Regret subject: `Tender outcome: <tenderTitle>`. Bodies: short, professional; win = "…has selected <companyName> for <tenderTitle>."; regret = "…the <tenderTitle> tender has been awarded to another bidder. Thank you for bidding." No links needed.

- [ ] **Step 2: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add apps/web/lib/email/tender-award.ts
git commit -m "feat(tender): award win/regret email builders"
```

---

## Task 5: Unseal + Award actions

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/tender/actions.ts`

- [ ] **Step 1: `unsealTender`** (mirror the file's `requireOrg()` + error handling):

```ts
export async function unsealTender(formData: FormData): Promise<void> {
  const { supabase, userId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const orgId = String(formData.get('orgId') ?? '');   // hidden field from the page (ctx.active.orgId)
  const { error } = await supabase.rpc('unseal_tender', { p_tender_id: tenderId });
  if (error) throw new Error(error.message);
  await logAudit({ orgId, actorId: userId, entityType: 'boq_tender', entityId: tenderId, action: 'tender.unsealed' });
  revalidatePath(`/boq/${boqId}/tender`);
}
```
Add `import { logAudit } from '@/lib/audit';` at top.

- [ ] **Step 2: `awardTender`** — call the RPC, then email winner + regret to other submitted bidders (best-effort, `isRedirect` guard):

```ts
export async function awardTender(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const bidderId = String(formData.get('bidderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');

  const { error } = await supabase.rpc('award_tender', { p_tender_id: tenderId, p_bidder_id: bidderId });
  if (error) throw new Error(error.message);

  // Notify everyone (best-effort). Staff can read boq_bidders (staff RLS policy).
  try {
    const [{ data: org }, { data: tender }, { data: bidders }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('boq_tenders').select('title').eq('id', tenderId).single(),
      supabase.from('boq_bidders').select('id, company_name, contact_email, status').eq('tender_id', tenderId).eq('status', 'submitted'),
    ]);
    const orgName = (org as { name?: string } | null)?.name ?? 'DatumPro';
    const tenderTitle = (tender as { title?: string } | null)?.title ?? 'Tender';
    for (const b of ((bidders ?? []) as { id: string; company_name: string; contact_email: string }[])) {
      const isWinner = b.id === bidderId;
      const { subject, html } = isWinner
        ? awardWinEmail({ orgName, tenderTitle, companyName: b.company_name })
        : awardRegretEmail({ orgName, tenderTitle, companyName: b.company_name });
      await sendEmail({ to: b.contact_email, subject, html });
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] award emails failed:', e);
  }
  revalidatePath(`/boq/${boqId}/tender`);
}
```
Add `import { awardWinEmail, awardRegretEmail } from '@/lib/email/tender-award';`.

- [ ] **Step 3: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add "apps/web/app/(app)/boq/[boqId]/tender/actions.ts"
git commit -m "feat(tender): unseal (audit-logged) + award (win/regret emails) actions"
```

---

## Task 6: Owner comparison UI

**Files:**
- Create `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx`
- Modify `apps/web/app/(app)/boq/[boqId]/tender/page.tsx`

- [ ] **Step 1: `comparison.tsx`** (`'use client'`), props `{ data: TenderComparison; boqId: string; orgId: string; canManage: boolean }`:
  - **Summary matrix:** a table — left columns Item No · Description · Unit · Qty · Budget/Est · Budget total (from `data.sections`), then **one column per bidder** in `data.bidders` order (cheapest first). The header for each bidder shows company name + **total** + **variance** (e.g. `-4.2%` green if under budget, red if over) + **rank** badge (`#1` etc.). Under each bidder column, show each line's `amountCents` (or "—" for no_bid).
  - **Per-line highlight:** for each item row, highlight the lowest bidder amount green and the highest red (only when ≥2 bidders).
  - **Drill-in:** clicking a bidder column header expands/links to that bidder's full priced bill beside the budget (rate + amount per line, plus the total). Implement as an expandable panel below the matrix or a selected-bidder detail table — keep it in this one client component.
  - **Award:** when `canManage` and `data.status !== 'awarded'`, each bidder header has an **Award** button (`<form action={awardTender}>` with hidden tenderId/bidderId/boqId + a `window.confirm`). When `data.status === 'awarded'`, mark `data.awardedBidderId` with an "Awarded ✓" badge and hide the buttons.
  - Use `fmtMoney(_, data.currency)` for money; zinc/brand tokens; `Badge` for rank/awarded.

- [ ] **Step 2: Wire `page.tsx`:**
  - Keep the existing behaviour (create form / bidders panel).
  - When a tender exists and is **sealed** (`tender.unsealedAt` null): in the bidders panel area, if `canManage`, show an **Unseal bids** button — enabled only when `getTenderOwnerExtras(tender.id).unsealEligible` is true, else disabled with a hint ("Unseal unlocks when all invited bidders submit, or after the deadline."). The button posts `unsealTender` with hidden `tenderId`, `boqId`, `orgId`.
  - When **unsealed**: call `getTenderComparison(ctx.active.orgId, boqId)`; if non-null, render `<Comparison data={...} boqId={boqId} orgId={ctx.active.orgId} canManage={canManage} />` below (or instead of) the bidders panel.

- [ ] **Step 3: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add "apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx" "apps/web/app/(app)/boq/[boqId]/tender/page.tsx"
git commit -m "feat(tender): owner comparison matrix — unseal, ranked bidders, per-line highlight, drill-in, award"
```

---

## Task 7: E2E verification + docs + ship

- [ ] **Step 1: Rolled-back RPC E2E** (controller, via MCP): seed a tender with 2 bidders both submitted (with differing bid_items); assert `tender_unseal_eligible` true; `unseal_tender` sets unsealed_at; `getTenderComparison`-shaped query returns ranked totals + variance; `award_tender(t, cheaper)` sets status/awarded_bidder_id; awarding a sealed tender or non-submitted bidder raises. Roll back.
- [ ] **Step 2: Security check** — `tender_unseal_eligible`/`unseal_tender`/`award_tender` are SECURITY DEFINER with pinned search_path; no new tables (so no new RLS surface).
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-08-09-boq-sealed-tender-design.md` status: Phase 2 shipped.
- [ ] **Step 4:** Merge branch → `main`; push; confirm Vercel READY and `/boq/<id>/tender` still 307→sign-in.

---

## Self-Review notes
- **Spec coverage:** unseal gate = all-submitted-or-deadline (Task 1 `tender_unseal_eligible` + Task 2 assertions); audit-logged unseal (Task 5 `logAudit`); comparison matrix total/variance/rank + drill-in + per-line highlight (Tasks 3,6); award marks winner + win/regret emails to all submitted bidders (Tasks 4,5); award requires unseal + valid bidder (Task 1). Cryptographic seal / project-generation still out (unchanged).
- **Type consistency:** `TenderComparison`/`CompareBidder.rates` keyed by `itemId`; `getTenderComparison(orgId, boqId)`; actions read hidden `tenderId`/`bidderId`/`boqId`/`orgId` fields — page must render those hidden inputs.
- **RLS-on-RETURNING:** award/unseal are SECURITY DEFINER RPCs returning scalars/void — no client RETURNING under RLS. Staff comparison reads rely on the Phase-1 `unsealed_at` gate (now satisfied).
