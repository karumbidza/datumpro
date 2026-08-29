# Program of Works (auto-schedule on award) + Contractor Timeline

**Date:** 2026-08-29
**Status:** Approved (design)
**Branch:** `feat/program-of-works-timeline` (off `main`)

## Problem

Two linked gaps:
- **D — no program of works.** Awarding a BOQ tender generates tasks and sets `agreed_duration_days` (from the bid's working-days per line), but never schedules them, so tasks have no `planned_start_date/planned_end_date/due_date`. The `schedule_boq_tasks(project, boq, start_date)` forward-pass scheduler exists but is a *separate* manual step in the project BOQ tab.
- **C — contractors get a flat list.** The personal home renders `MyTasksCard` (a flat list) for contractor/viewer/member, while managers get the `TimelineOverview` Gantt. A contractor has no timeline / program-of-works view.

C depends on D: without scheduled dates the timeline is empty.

## Goal

Awarding auto-generates the contractor's **program of works** (every task gets planned dates from a controllable site start date), and contractors/viewers see their work on the **existing `TimelineOverview` Gantt** instead of a flat list.

## Decisions (from brainstorming)

- Start date: **award auto-schedules**, defaulting to the win date (today), with an optional **"Site start date"** field to set a future mobilisation date; re-schedulable anytime via the existing Schedule panel.
- Contractor view: **timeline of their own assigned tasks** (task-level), reusing `TimelineOverview`, plus stat cards + upcoming.

## Architecture

App-layer only — **no migration**. `schedule_boq_tasks` and `TimelineOverview` already exist.

### D — Auto-schedule at award

`schedule_boq_tasks(p_project_id uuid, p_boq_id uuid, p_start_date date) → jsonb` returns `{ scheduled, frozen, missing_duration[], project_end }` and writes `planned_start_date / planned_end_date / due_date` on `'todo'` tasks (started/done frozen).

1. **`awardTender` (`apps/web/app/(app)/boq/[boqId]/tender/actions.ts`)** — after the existing best-effort `export_award_to_project` returns a `project_id`, chain scheduling (also best-effort — a schedule failure must not undo the award):
   ```ts
   const startDate = String(formData.get('startDate') ?? '').trim() || todayISODate();
   // … after deliveredProjectId is set …
   if (deliveredProjectId) {
     try {
       await supabase.rpc('schedule_boq_tasks', {
         p_project_id: deliveredProjectId,
         p_boq_id: boqId,
         p_start_date: startDate,
       });
     } catch (e) {
       console.error('[tender] auto-schedule failed (award + tasks stand):', e);
     }
   }
   ```
   `todayISODate()` = the current date as `YYYY-MM-DD` (server local). Runs BEFORE the existing `redirect(...)`.
2. **Award form (`comparison.tsx`)** — add an optional `<input type="date" name="startDate">` labelled "Site start date" (default value = today, `min` = today) to the award `<form>` so the owner can set a mobilisation date. When blank, the action falls back to today.
3. **Recovery path (`start-delivery.tsx` / `startDelivery` action)** — the manual "Finish delivery setup" flow already passes a project mode; add the same `startDate` field there and chain `schedule_boq_tasks` after `export_award_to_project`, so the recovery path also produces a program of works. (The existing Schedule panel remains for later re-scheduling.)
4. **Missing durations** — `schedule_boq_tasks` returns `missing_duration[]` (tasks with no `agreed_duration_days`). These are simply left unscheduled by the RPC; surface the count in the redirect/toast is out of scope — the Schedule panel already reports it.

### C — Contractor / personal-home timeline

`TimelineOverview` props: `{ tasks: DashboardTask[]; unit?: 'task' | 'project' }`. `DashboardTask = { id, title, status, sla_status, project_id, projectName, assigneeName, planned_start_date, planned_end_date, due_date, actual_end_date }`.

1. **New data function** `listMyTimelineTasks(userId)` in `apps/web/lib/data/dashboard.ts` (or `home.ts`) — returns `DashboardTask[]` for tasks where `assignee_id = userId` (ALL statuses, not just open), joined to `projects(name)`, shaped exactly like `getDashboardData` rows. RLS already scopes to the caller's tasks.
2. **Personal home (`dashboard/page.tsx`, the member/contractor/viewer branch, ~line 153-181)** — replace the bare `<MyTasksCard tasks={myTasks} />` with:
   - small stat cards: **Assigned · In progress · Overdue · Done** (derived from the timeline tasks; overdue = not done AND `due_date < today` OR `sla_status='breached'`),
   - `<TimelineOverview tasks={myTimelineTasks} unit="task" />`,
   - a compact **Upcoming** list (reuse `MyTasksCard` or `UpcomingTasksTable` for the soonest-due open tasks),
   - keep the existing "My payments" card.
   Use a wider `PageContainer` (`width="6xl"`) for this branch so the Gantt has room (personal home is currently `3xl`).
3. **Roles** — this branch serves member/contractor/viewer. Contractors/members see their assigned tasks. Viewers typically have no assigned tasks (their timeline shows empty, which is acceptable); a project-scoped viewer timeline is a future refinement. PM ('delivery' persona) already has `TimelineOverview` — unchanged.

## Data flow
Award → `export_award_to_project` (tasks + `agreed_duration_days`) → `schedule_boq_tasks(start_date)` (sets planned dates = program of works) → contractor's `TimelineOverview` renders the bars. Re-scheduling (slip start / durations change) via the Schedule panel re-runs the forward pass.

## Error / edge handling
- Auto-schedule is best-effort; award + tasks persist even if scheduling throws.
- Blank/invalid start date → fall back to today (never pass an empty string to the `date` RPC param).
- Winner with no account → export skipped (existing) → nothing to schedule → recovery UI (existing).
- Tasks with no `agreed_duration_days` → left unscheduled by the RPC (reported by the Schedule panel).
- `listMyTimelineTasks` with zero tasks → timeline + stats render empty gracefully (TimelineOverview already handles an empty list).

## Testing
No unit harness for these client components/actions. Gates: `pnpm -C apps/web typecheck` + `eslint` on changed files; full `next build`. Manual:
1. Award a tender with a future Site start date → land on tasks; every task has `planned_start/end`; contractor's home shows a populated Gantt starting on that date; dependencies stagger correctly.
2. Award with blank start date → schedules from today.
3. Contractor home: stat cards + timeline of their tasks + upcoming + payments; wider layout.
4. Re-run the Schedule panel with a new date → bars shift; started tasks stay frozen.
5. Regression: award still emails + redirects; `export_award_to_project` unchanged; RLS suites unaffected (no DB change).

## Out of scope
- Any DB/RPC change (schedule_boq_tasks + export unchanged). A project-scoped viewer timeline. Per-individual-task start dates outside the BOQ program (the whole-project forward pass is the model). Critical-path / auto-reschedule-on-late-finish (future).
