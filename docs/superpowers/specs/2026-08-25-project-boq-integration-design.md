# Project ↔ BOQ Integration — Design Spec

**Date:** 2026-08-25
**Status:** Approved design, pending implementation plan
**Depends on:** BOQ library + nested sections (shipped), sealed tender flow (shipped), award-to-project export `export_award_to_project` (shipped), BOQ Excel import upgrades (merged 2026-08-25, commit `e2ea71e`)

## 1. Problem

Projects and BOQs are disconnected at creation time. A new project starts empty and tasks are entered freehand; the BOQ lives under a separate top-level nav item. The only bridge is one-directional and late: an *awarded tender* can be exported to a project ("Start delivery"). There is no way to:

- start a project **from** a BOQ (without running a tender),
- create a BOQ **as part of** project setup,
- attach a BOQ to an existing project,
- trace a task/subtask back to the BOQ line it came from.

## 2. Core model decision

> **A BOQ is a pre-contract document that should eventually resolve to a project. A project may start with a BOQ, gain one later, or never have one.**

A standalone BOQ remains valid (estimating, tendering, templates, lost bids). A BOQ is never *required* to have a project, and a project is never *required* to have a BOQ. The BOQ→tasks generation engine is shared: award export (assigns winner, bid rates) and project setup (unassigned, budget rates) are two entry points to the same output shape.

Decisions confirmed with the product owner (2026-08-25):

1. **Tasks generated from a BOQ without a tender** are unassigned and priced at internal `budget_rate_cents`; contractors are assigned later via the existing acceptance → priced plan → approval chain.
2. **A project-linked BOQ can still go to tender.** On award, existing tasks are assigned to the winner and repriced at bid rates (no new project created).
3. **Navigation:** the top-level BOQ item stays as the org library / contractor tender portal; linked projects gain a project-level BOQ tab.

## 3. Data model (one migration)

| Change | Detail |
|---|---|
| `boqs.project_id` | Nullable composite FK → `projects(id, org_id)`. No unique constraint (a project may hold multiple BOQ packages; UI treats one as the normal case). |
| `tasks.boq_section_id` | Nullable composite FK → `boq_sections(id, org_id)`. Records the section a task was generated from; used by award to find/reassign the right tasks. `on delete set null`. |
| `task_subtasks.boq_item_id` | Nullable composite FK → `boq_items(id, org_id)`. Line-level traceability (estimate vs. bid vs. actual). `on delete set null`. |
| Backfill | For tenders with `awarded_project_id` set, copy it to the BOQ's `project_id` (skip if the BOQ would gain two conflicting projects; first award wins). |

RLS: no new policies needed — all three columns live on tables with existing org-scoped policies. Writes to `boqs.project_id` are already restricted to admin/PM by the existing BOQ write policies; the generation RPC validates project membership in the same org.

## 4. Generation engine: `generate_tasks_from_boq(p_boq_id, p_project_id)`

A new `security definer` RPC, factored to share its shape with `export_award_to_project`:

- **Guards:** caller is org admin/PM (`is_org_admin` / `can_manage_project`); BOQ and project belong to the same org; BOQ is not a template; project has no tasks already generated from this BOQ (idempotency: reject if any task with `boq_section_id` belonging to this BOQ exists).
- **Output:** one task per section that has ≥1 item, walking nested sections in the same order and numbering scheme as the award export (`"{secNo}. {name}"`); one subtask per item (`"{itemNo or secNo.lineNo} {description} — {qty} {uom}"`), `cost_cents = round(qty × budget_rate_cents)`, `boq_item_id` set, positions preserved. Uses the imported `item_no` when present (from the import upgrade) instead of the positional number.
- **Task state:** `assignee_id = null`, `acceptance_status` untouched (the `set_task_pending_on_assign` trigger handles it at assignment time), no `plan_approved_at`, no `awarded_cost_cents`. Budget-priced subtasks are the *starting plan*; the existing contractor plan/approval flow takes over after assignment.
- Sets `boqs.project_id = p_project_id` if not already set; errors if set to a *different* project.

## 5. Project creation flow

`/projects/new` gains a "Bill of Quantities" section with three radio choices:

1. **No BOQ** (default) — current flow, unchanged.
2. **Use existing BOQ** — dropdown of org BOQs where `is_template = false` and `project_id is null` (any status; a draft can be attached, tasks generate from whatever lines exist). After the project insert succeeds, the server action calls `generate_tasks_from_boq`. Failure of generation does not roll back the project; the user lands on the project BOQ tab with the error and a retry button.
3. **Create BOQ now** — after project insert, create a draft BOQ pre-filled from the form (name, client_id/client_name, currency, `project_id`), then redirect to `/boq/{boqId}` (builder) instead of the project setup page. Tasks are **not** generated incrementally; when the user marks the BOQ **approved**, the builder prompts "Generate tasks for {project}?" which calls the same RPC.

## 6. Award flow changes ("Start delivery")

`export_award_to_project` grows three modes, keyed off the BOQ's state:

- **Standalone BOQ (today's flow):** unchanged — choose new/existing project; creates tasks assigned to winner at bid rates; sets `awarded_project_id` *and now also* `boqs.project_id`.
- **Project-linked BOQ, tasks already generated:** UI skips the project picker. RPC enrolls the winner (org contractor member + project member, as today), then per section-task matched via `boq_section_id`: set `assignee_id` to winner, `acceptance_status = 'accepted'`, `plan_approved_at = now()`; per subtask matched via `boq_item_id` with a priced bid line (`no_bid = false, rate_cents not null`): `cost_cents = round(qty × rate_cents)`; recompute `awarded_cost_cents` per task. Subtasks whose line the winner no-bid keep budget pricing and are reported in the RPC result for PM follow-up.
- **Project-linked BOQ, tasks never generated:** generate tasks assigned to the winner at bid rates, targeted at the linked project (today's logic minus project creation).

**Reassignment guard:** any task already assigned to someone (`assignee_id is not null`) before award is skipped — not silently reassigned — and returned in the RPC result so the UI can flag it.

## 7. Navigation & UI

- **Top-level BOQ nav:** unchanged role behavior (staff library / contractor tender portal). Library table gains a "Project" column linking to the attached project.
- **Project nav:** new **BOQ** tab, manager-visible (same gate as Finance). States:
  - No BOQ → empty state with "Attach existing BOQ" (picker of unlinked, non-template BOQs) and "Create BOQ" (draft pre-filled from project, opens builder).
  - Linked, tasks not generated → BOQ summary + "Generate tasks" button.
  - Linked, tasks generated → read-focused summary (sections, totals, tender status if any) with links to the builder and the generated tasks. If the BOQ changed after generation (any section/item `updated_at`/`created_at` newer than generation time), show a "bill changed after task generation" notice.
- **BOQ builder header:** shows the linked project as a breadcrumb/link when `project_id` is set.

## 8. Edge cases & v1 scope limits

- **BOQ edits after generation:** no auto-sync in v1. Scope changes flow through the existing subtask *variation* mechanism. The BOQ tab shows the drift notice only.
- **Unlinking:** clearing `project_id` (admin/PM, from the BOQ tab) keeps generated tasks and their `boq_section_id`/`boq_item_id` references intact — they are real work. The project simply loses its BOQ tab content.
- **Deleting a linked BOQ:** blocked while `project_id` is set (must unlink first). The FKs on tasks/subtasks are `set null`, so history degrades gracefully if a BOQ is force-deleted after unlinking.
- **Multiple BOQs per project:** schema allows it; v1 UI shows the first/only BOQ and offers attach only when none is linked. Multi-package UI is v2.
- **Partial generation** (choose subset of sections): out of scope for v1.
- **Estimate vs. bid vs. actual variance dashboard:** enabled by `boq_item_id` traceability, but out of scope for v1.

## 9. Testing

- **RPC tests (pgTAP/SQL like existing tender tests):** guards (non-staff rejected, cross-org rejected, template rejected, double-generate rejected); nested-section ordering matches award export; budget pricing math; award-repricing (bid rates applied, no-bid lines kept at budget, assigned tasks skipped and reported); backfill correctness.
- **App checks:** project creation with each of the three BOQ choices; BOQ tab states; approve-BOQ → generate prompt; "Start delivery" with a linked BOQ skips project picker.

## 10. Rollout order

1. Migration (columns + backfill).
2. `generate_tasks_from_boq` RPC + tests.
3. `export_award_to_project` modes + reassignment guard + tests.
4. Project creation form BOQ step.
5. Project BOQ tab + builder breadcrumb + library "Project" column.
