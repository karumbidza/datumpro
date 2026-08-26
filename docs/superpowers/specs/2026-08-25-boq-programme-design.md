# BOQ Programme — Durations, Dependencies, Scheduler — Design Spec

**Date:** 2026-08-25
**Status:** Approved design (user, 2026-08-25), pending implementation
**Depends on:** Project↔BOQ integration (shipped 2026-08-25: `boqs.project_id`, `tasks.boq_section_id`, `task_subtasks.boq_item_id`, `generate_tasks_from_boq`, `export_award_to_project` v2)

## 1. Problem

BOQ-generated tasks carry no dates, so they never appear on the Timeline Overview (which plots `planned_start_date` + `due_date`/`planned_end_date`) and SLA tracking has nothing to bite on. A bill traditionally has no programme; the owner wants agreed per-task timelines (SLAs) that come out of the tender, plus a dependency-driven schedule where independent work runs concurrently.

## 2. Approved flow

1. **Tender**: bidders submit a rate **and a proposed duration in working days** per line.
2. **Award**: the winner's durations become each task's agreed SLA duration.
3. **PM sets the project start date** (or accepts the project's existing start date).
4. **Scheduler**: tasks with no predecessors start on day one (concurrent); each dependent task starts the working day after its latest predecessor ends; end = start + agreed duration in working days on the project calendar. Planned dates land on tasks → timeline populates, SLA clocks work, the shipped dependency start-gate enforces order on site.

Decisions confirmed: dependencies are defined **on BOQ sections** (copied to tasks at generation); durations are proposed **per line and rolled up** (task SLA = sum of its lines' days).

## 3. Data model (one migration)

| Change | Detail |
|---|---|
| `boq_items.duration_days` | `int` null. The office's estimated working days per line (builder column next to Budget/Est). Fallback SLA source when work is assigned without a tender. |
| `boq_bid_items.duration_days` | `int` null. The bidder's proposed working days for that line. Sealed with the rates. |
| `boq_section_deps` | New table: `(org_id, section_id, depends_on_id)` composite-FK'd to `boq_sections(id, org_id)`, PK `(section_id, depends_on_id)`, both cascade on delete. Same-bill enforced by trigger or check via join in RPC. Multiple predecessors allowed. Self-reference rejected. |
| `tasks.agreed_duration_days` | `int` null. The task's SLA duration: sum of its lines' `duration_days` (budget at generation; overwritten with the winner's at award). Null when no line has a duration. |
| RLS | `boq_section_deps`: same posture as `boq_sections` (staff read via `is_org_staff`, admin/PM write). No other policy changes. |

## 4. RPC / engine changes

**`generate_tasks_from_boq`** — additionally: `agreed_duration_days = sum(item duration_days)` per task (null if none); after creating tasks, copy `boq_section_deps` into `task_dependencies` (predecessor/successor task ids via the section→task map, `lag_days = 0`), skipping links whose sections produced no task.

**`export_award_to_project`** —
- *Generate mode*: same roll-up but from the winner's `boq_bid_items.duration_days` (fallback to item budget duration when the bid line has no days); copy section deps as above.
- *Reprice mode*: recompute `agreed_duration_days` per task from the winner's bid days (fallback budget days); tasks skipped for reassignment also keep their old duration. Dependencies are NOT re-copied (they exist from generation).

**`schedule_boq_tasks(p_project_id, p_boq_id, p_start_date)`** — new SECURITY DEFINER RPC, admin/PM guarded (coalesced), same-org validated:
- Operates on the project's tasks generated from this bill. Tasks already started (`status <> 'todo'`) or done are **frozen**: their existing dates are kept and used as inputs for successors.
- Forward pass: topological order over `task_dependencies` restricted to this task set; cycle → `raise exception 'dependency cycle detected'`. No-predecessor tasks start `p_start_date`. Successor start = next working day after `max(predecessor planned_end)` (existing `add_working_days` with the project's `calendar_id`; if the project has no calendar, plain calendar days). `planned_end = add_working_days(start, max(agreed_duration_days,1) - 1)`; also sets `due_date = planned_end`. Tasks with null duration get `planned_start` only (flagged in the result).
- Returns jsonb: `{scheduled, frozen, missing_duration: [titles], project_end}`.
- Re-runnable any time; only rewrites dates of `todo` tasks.

## 5. UI

- **Builder**: "Days" column after Budget/Est (nullable int, same inline-edit pattern). Each top-level or nested section header gets an "After: …" control — a multi-select of the bill's other sections rendered as removable chips. Cycle-producing picks rejected server-side with a clear error.
- **Bidder pricing screen** (`/tender/[token]`): a "Days" input beside each rate. Optional. Sequence context shown read-only ("This section starts after: X").
- **Comparison matrix**: per-bidder days per line under the rate, a per-bidder **total days** roll-up per section, and a per-bidder **projected programme length** (forward pass in TS over section deps with that bidder's durations — working-day count, calendar-agnostic approximation labelled "~N working days").
- **Project BOQ tab**: a "Schedule" panel (visible once tasks are generated): date input defaulting to the project's `start_date`, a Schedule button calling the RPC, and the result summary (n scheduled, any missing durations listed). Re-schedule allowed; note explains started tasks are frozen.
- Timeline Overview and mobile progress/SLA views light up automatically from the written dates — no changes needed there.

## 6. Mobile + integrity gaps closed in the same release

- **Bill-line guard (DB, applies to web and mobile)**: assignees must not delete or reprice bill-derived plan lines. New trigger on `task_subtasks`: when `old.boq_item_id is not null` and the actor is not org admin / project manager, DELETE is rejected and UPDATE may only change progress/schedule fields (`is_done`, `done_at`, `planned_start_date`, `planned_end_date`, `position`) — `title`, `cost_cents`, `est_qty/est_unit` are frozen. Contractors can still ADD their own lines (variations flow unchanged). SECURITY DEFINER RPC paths run as manager-callers, so award repricing is unaffected.
- **Mobile start-gate hint**: the task detail screen shows "Waiting on: <predecessor titles>" for a `todo` task whose predecessors are unfinished, instead of a bare failed start. Data: a small query of `task_dependencies` joined to predecessor tasks' title/status.

## 7. Out of scope (v1)

Lag days in the UI (column exists, defaults 0), critical-path highlighting, auto-reschedule on late finish, native mobile BOQ tender bidding (web token link serves phones), manager payment approvals on mobile.

## 8. Testing

- Rolled-back live-DB sims + `rls_security.sql` additions: dep copying at generation; roll-up math (budget and bid, fallback); scheduler forward pass (chain A→B with parallel C: A and C start day one, B after A; working-day arithmetic respects the calendar); cycle rejection; frozen started tasks; guard trigger (assignee cannot delete/reprice a bill line, can tick it; manager can edit; contractor-added lines unaffected).
- Web: typecheck + build. Mobile: typecheck.

## 9. Rollout order

1. Migration (columns, deps table, guard trigger).
2. RPC updates + scheduler + tests → apply live.
3. Builder days column + section deps UI; bidder days input; comparison time columns.
4. Schedule panel on the BOQ tab.
5. Mobile "waiting on" hint.
