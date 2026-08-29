# Tender Award → Auto Start Delivery

**Date:** 2026-08-29
**Status:** Approved (design)
**Branch:** `feat/tender-award-auto-delivery` (off `main`)

## Problem

A BOQ tender's award is two separate manual actions: `awardTender` (sets winner, emails win/regret) and `startDelivery` (`export_award_to_project` — creates/uses the delivery project, generates costed tasks, enrols the winner, emails them). An owner who awards but never clicks "Start delivery" leaves the tender `awarded` with `awarded_project_id = NULL` and **zero tasks** — so the winning contractor sees nothing to work on. This happened live (tender `Magunje Build`, contractor `allenk@quillstonecapital.com`).

## Goal

Awarding a bidder automatically starts delivery, so "awarded" always means the winner can see the generated tasks/items. Keep the existing `StartDelivery` UI as a **recovery path** for the cases where auto-delivery can't run (e.g. the winner has no linked account).

## Design (app-layer only — no migration)

The DB RPCs (`award_boq_tender`, `export_award_to_project`) are unchanged. All changes are in the web app.

### 1. `awardTender` chains delivery (`apps/web/app/(app)/boq/[boqId]/tender/actions.ts`)

After `award_boq_tender` succeeds and the win/regret emails are sent (existing behaviour), attempt delivery **in the same action, best-effort**:

```ts
// … existing award RPC + win/regret emails …

// Auto-start delivery: create/use the project, generate tasks, enrol the winner.
// Best-effort — a failure (e.g. winner has no linked account) must NOT undo the
// award; the StartDelivery recovery UI stays available on the tender page.
let deliveredProjectId: string | null = null;
try {
  const { data: exp, error: expErr } = await supabase.rpc('export_award_to_project', {
    p_tender_id: tenderId,
    p_project_id: null,
    p_new_project_name: null, // RPC uses the BOQ's linked project, else a new project named after the BOQ
  });
  if (!expErr && exp) {
    deliveredProjectId = (exp as { project_id?: string }).project_id ?? null;
    // notify the winner their tasks are ready (mirror startDelivery's email)
    // … deliveryAssignedEmail to the awarded bidder's contact_email …
  } else if (expErr) {
    console.error('[tender] auto start-delivery failed (award stands):', expErr.message);
  }
} catch (e) {
  console.error('[tender] auto start-delivery threw (award stands):', e);
}

if (deliveredProjectId) {
  redirect(`/projects/${deliveredProjectId}/tasks`);
}
revalidatePath(`/boq/${boqId}/tender`);
```

Notes:
- `export_award_to_project` already enforces auth (`is_org_admin || pm`) — the awarding caller passes it. It uses the BOQ's linked project when present (Magunje's is), else creates a new project named after the BOQ; it raises if the winner has no linked account, which we swallow.
- The winner receives two emails on the happy path (award-win + delivery-assigned). Acceptable; both are relevant. (Optional refinement: skip the standalone award-win email when delivery succeeds — out of scope for v1.)
- Redirect only on success; otherwise revalidate so the recovery UI shows.
- Wrap the delivery email in its own try/catch (a mail failure must not block the redirect), matching `startDelivery`.

### 2. Award button copy (`apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx`)

- Button label `Award` → `Award & start delivery`.
- Confirm copy: append "… This creates the delivery project and generates their tasks." to the existing confirm string (both the fully-priced and the unpriced-lines variants).

No structural change to the form; it still posts `tenderId`, `bidderId`, `boqId` to `awardTender`.

### 3. `StartDelivery` becomes the recovery path (`apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx`)

It already renders only when the tender is `awarded` **and** `awarded_project_id` is null (see the tender page). With auto-delivery, that state now means "auto-delivery didn't run" (e.g. winner had no account). Update copy so it reads as recovery, not a required step:
- Collapsed button: `Start delivery →` → `Finish delivery setup →`.
- Add a one-line hint above it: "This tender is awarded but its tasks weren't generated yet — usually because the winner hasn't created an account." (Only in the non-`linkedProject` branch; the linked-project branch keeps its existing copy.)

Its new/existing project picker (the "advanced" escape hatch to attach to an existing project) is preserved here — it's the recovery UI.

### 4. Contractor portal badge (`apps/web/app/(app)/boq/contractor-portal.tsx`)

When `awardedToMe` is true, the badge already reads award state. Ensure an awarded tender reads clearly as **"Awarded to you"** (green) rather than looking like a still-open tender, so the window between award and tasks appearing is never blank. If the existing badge already does this, no change; otherwise adjust the label only.

## Error / edge handling
- Winner has no linked account → `export_award_to_project` raises → caught, award stands, recovery UI shows. (This is the ONE genuine reason auto-delivery is skipped.)
- Tender already exported (`awarded_project_id` set) → RPC raises "already exported"; caught. Can't happen on first award (award button hidden once `status='awarded'`).
- Delivery email failure → caught separately; redirect still happens.
- `redirect()` throws a Next control-flow error — must be OUTSIDE the try/catch (or re-thrown via the existing `isRedirect(e)` guard already used in this file).

## Testing
No unit harness for these actions/components. Gates: `pnpm -C apps/web typecheck` + `eslint` on changed files; full `next build` at the end. Manual:
1. Award a tender whose winner has a linked account → lands on the project tasks page; tasks generated; contractor enrolled; contractor sees items.
2. Award a tender whose winner has NO account → award succeeds, emails sent, tender page shows "Finish delivery setup" recovery UI; no crash.
3. The existing `startDelivery` action/UI still works for the recovery case (new & existing project modes).
4. Regression: `export_award_to_project` unchanged; RLS suites unaffected (no DB change).

## Out of scope
- Any DB/RPC change. Suppressing the duplicate award-win email. A combined single-transaction `award_and_export` RPC (app-layer chaining is sufficient and keeps award durable if delivery fails). Task-level (`task_tender_invites`) tenders — this is the BOQ tender flow only.
