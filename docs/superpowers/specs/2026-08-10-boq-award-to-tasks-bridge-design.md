# Award → costed-tasks bridge — design

**Date:** 2026-08-10
**Status:** Approved, ready for plan.
**Scope:** Piece 3 of 3 in the BOQ role/award programme. (Piece 1 — flag incomplete
bids — and Piece 2 — role-aware `/boq` — both shipped.) This was explicitly deferred as
YAGNI in the original tender spec ("auto-generating a project/contract from the award");
it is now being built.

## Goal

Convert an **awarded BOQ tender** into a **delivery project + tasks/subtasks** assigned
to the winning contractor, seeded with their winning bid rates, so the contractor sees
costed BOQ-style work and ticks each line to completion, and staff track job completion
through the existing delivery screens. Because the tender already did competitive pricing
and award, the generated plan is **pre-priced and pre-agreed** — no re-quoting.

## Decisions (from brainstorming)

1. **Trigger & target:** an explicit staff **"Start delivery"** action on the awarded
   tender, offering **new project** (name pre-filled from the BOQ) **or add to an
   existing project**. Not automatic on award.
2. **Mapping:** **BOQ section → task; line item → priced subtask.** Contractor ticks each
   line; task completes when all its lines are ticked.
3. **Entry state:** tasks are created **auto-accepted + plan pre-approved**
   (`acceptance_status='accepted'`, `plan_approved_at=now()`, `awarded_cost_cents` locked
   from the winning bid). Contractor goes straight to ticking.
4. **Winner onboarding:** the export **auto-enrols** the winner as an org member
   (`member_type='contractor'`) if not already, and as a `project_members` row
   (`role='contractor'`), then assigns the tasks.

Baked-in detail decisions (approved):
- **(a)** Unpriced / `no_bid` lines are **excluded** from generated work (only lines the
  winner priced become subtasks; a section with zero priced lines is skipped).
  `awarded_cost_cents` therefore equals the winner's bid total.
- **(b)** qty + uom live in the **subtask title** (e.g. `1.1 Excavate to reduced level —
  10 m³`); `cost_cents` = line total; `est_qty`/`est_unit` left null.
- **(c)** Generated tasks set `requires_photo_on_complete=false` (line-ticking is the
  completion signal; staff can re-require per task later).
- **(d)** **Idempotent:** re-export is blocked once `boq_tenders.awarded_project_id` is
  set; the button becomes "View delivery project".
- **(e)** Best-effort email to the winner ("Work assigned — log in to view your tasks"),
  same fire-and-forget style as existing tender emails.

## Architecture

One atomic **SECURITY DEFINER RPC** does the whole conversion (all-or-nothing); a
staff-only dialog + server action calls it; the contractor reuses existing delivery
screens (no new contractor UI).

### Data model (confirmed against prod schema)

- `tasks`: required `org_id, project_id, title`. Nullable & set by us:
  `assignee_id`, `acceptance_status='accepted'`, `plan_approved_at=now()`,
  `awarded_cost_cents`. Defaults kept: `status='todo'`, `priority='medium'`. Override:
  `requires_photo_on_complete=false`.
- `task_subtasks`: required `org_id, task_id, title`; `cost_cents` (default 0) set to the
  line total; `is_done` default false; `is_variation` default false; `bid_contractor_id`
  null (this is the awarded plan, not a competing bid); `position` sequential.
- `projects`: required `org_id, name`; set `type='construction'` (default),
  `status='active'`, `contract_value_cents` = winner total, `created_by` = caller. The
  `on_project_created` trigger auto-enrols the caller as project PM.
- `project_members`: `role='contractor'` for the winner.
- `org_members`: winner inserted `member_type='contractor'` (org_role defaults to
  `member`) `on conflict (org_id,user_id) do nothing`.

Relevant existing triggers (no conflict): `set_task_pending_on_assign()` keeps
`acceptance_status` when already `'accepted'`; `enforce_subtask_window()` is satisfied
because we set no subtask dates; `enforce_subtask_ticker()` lets only the assignee tick
`is_done` — which is exactly the winning contractor.

### Schema migration (one column)

```sql
alter table public.boq_tenders
  add column awarded_project_id uuid,
  add constraint boq_tenders_awarded_project_fk
    foreign key (awarded_project_id, org_id)
    references public.projects (id, org_id) on delete set null;
```
(Composite FK matches the app's `(id, org_id)` tenancy pattern.)

### RPC: `export_award_to_project(p_tender_id uuid, p_project_id uuid default null, p_new_project_name text default null) returns uuid`

SECURITY DEFINER, `set search_path=''`, granted to `authenticated`. Returns the target
project id. Steps:

1. Load tender `(org_id, status, awarded_bidder_id, awarded_project_id, boq_id)`; raise if
   not found.
2. **Authorise:** raise unless `is_org_admin(org)` or `org_role(org)='pm'`.
3. **Guard:** raise if `status <> 'awarded'`; raise if `awarded_project_id is not null`
   ("already exported"); raise if `awarded_bidder_id is null`.
4. Resolve winner: `select user_id, company_name from boq_bidders where id =
   awarded_bidder_id`; raise if `user_id is null`.
5. **Project:** if `p_project_id` provided, verify it belongs to org and use it; else
   `insert into projects (...)` with `name = coalesce(nullif(trim(p_new_project_name),''),
   <boq name>)`, `status='active'`, `created_by = auth.uid()` (leave `contract_value_cents`
   at its default; the real total is written in step 8). Capture `v_project`, and a
   `v_created_new` flag.
6. **Onboard winner:** `insert into org_members (org_id,user_id,role,member_type,status)
   values (org, winner, 'member','contractor','active') on conflict (org_id,user_id) do
   nothing`; `insert into project_members (org_id,project_id,user_id,role) values (...,
   'contractor') on conflict (project_id,user_id) do nothing`.
7. **Generate work:** for each `boq_section` (ordered by position):
   - Compute the section's priced lines: `boq_items` joined to the winner's
     `boq_bid_items` where `no_bid = false and rate_cents is not null`.
   - If none, **skip** the section (no empty task).
   - Insert one `task` (title = section name, assignee = winner,
     `acceptance_status='accepted'`, `plan_approved_at=now()`,
     `requires_photo_on_complete=false`).
   - For each priced line insert a `task_subtask`
     (title = `<item_no> <description> — <qty> <uom>`, `cost_cents = round(qty ×
     rate_cents)`, `position` sequential).
   - Set the task's `awarded_cost_cents` = sum of its subtask `cost_cents`.
8. **Link + total:** `update boq_tenders set awarded_project_id = v_project`; if
   `v_created_new`, set the project's `contract_value_cents` = total across all generated
   tasks (the winner's bid total). (For an existing project, leave its
   `contract_value_cents` untouched.)
9. Return `v_project`.

Item numbering (`1.1`, `2.3`) is derived from section/item position, matching the BOQ
grid's display convention.

### App layer

- **Data:** the owner tender view (`getTenderComparison` / `getTenderOwnerExtras`) already
  exposes the awarded bidder + winner total; add `awardedProjectId` to the owner extras so
  the UI knows whether export already happened.
- **Server action** `startDelivery` in `app/(app)/boq/[boqId]/tender/actions.ts`: reads
  `tenderId`, a `mode` (`new`|`existing`), and either `projectName` or `projectId`; calls
  `export_award_to_project`; sends the best-effort winner email; redirects to
  `/projects/<id>/tasks`.
- **UI** on the awarded tender (`comparison.tsx` or a small sibling component): when the
  tender is `awarded` and `awardedProjectId is null`, show **"Start delivery →"** opening a
  dialog (new project name **or** existing-project select, options from the org's
  projects). When `awardedProjectId` is set, show **"View delivery project →"** linking to
  it. Staff-only (behind the existing `canManage`).
- **Email** `lib/email/tender-delivery.ts`: `deliveryAssignedEmail(to, { projectName,
  taskCount })`, best-effort with the `isRedirect` guard pattern used by the other tender
  emails.

## Explicitly NOT in this piece (YAGNI)

- No re-pricing / variations at export (variations use the existing post-approval flow).
- No auto-scheduling of task dates (dates left null; staff/contractor set them later).
- No new contractor-side screens (reuse My Tasks / project Tasks).
- No partial/multi-winner award split (single awarded bidder → one export).
- No un-export / rollback UI (idempotency blocks duplicates; undo is manual if ever needed).

## Verification

- **RPC E2E (rolled-back sim via MCP `execute_sql`):** seed org + staff + a BOQ (2
  sections, priced + one no_bid line) + tender awarded to a contractor bidder; call
  `export_award_to_project` (new-project path); assert: project created, winner is an
  org `contractor` + project `contractor`, one task per non-empty section, one subtask per
  priced line (no_bid line excluded), `cost_cents` = qty×rate, task `awarded_cost_cents` =
  section total, project `contract_value_cents` = winner total, tasks `acceptance='accepted'`
  + `plan_approved_at` set, `boq_tenders.awarded_project_id` set. Then call again → raises
  "already exported". Also test the existing-project path and a non-staff caller (raises).
- Add the key invariants (winner isolation, idempotency, staff-only) to
  `supabase/tests/rls_security.sql` where they fit the suite style.
- `pnpm turbo run typecheck lint --filter=@datumpro/web` clean.
- Manual: award a tender → Start delivery → confirm the contractor sees the costed tasks
  in My Tasks and can tick a line; staff see the project + task costs.
