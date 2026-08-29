# Program of Works + Contractor Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Awarding a BOQ tender auto-schedules the tasks into a program of works from a controllable site start date, and contractors/viewers see their work on the existing `TimelineOverview` Gantt instead of a flat list.

**Architecture:** App-layer only — `schedule_boq_tasks` (forward-pass scheduler) and `TimelineOverview` already exist. Chain `schedule_boq_tasks` after the award's `export_award_to_project`; add a "Site start date" field; add a `listMyTimelineTasks` data function and render the timeline on the personal home.

**Tech Stack:** Next.js App Router server actions + server components, Supabase RPC, React, Tailwind.

**Branch:** `feat/program-of-works-timeline` (created; spec committed).

**No test harness** for these client components/actions. Per-task gate: `pnpm -C apps/web typecheck` + `eslint` on changed files. Behaviour gates are manual.

**Guardrails:** NEVER `git add -A`/`.` — untracked `apps/web/app/api/admin/{analytics,flags,logs}/` must never be staged; stage only named files. A full typecheck may emit errors ONLY in `.next/types/validator.ts` about `app/api/admin/*` — pre-existing noise, treat as passing. `react-hooks/exhaustive-deps` IS enabled (warn) — no new eslint-disable. `noUncheckedIndexedAccess` is ON.

---

## File Structure
- **Modify** `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` — `awardTender` + `startDelivery` chain `schedule_boq_tasks`; read `startDate`.
- **Modify** `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx` — add "Site start date" input to the award form.
- **Modify** `apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx` — add "Site start date" input to the recovery forms.
- **Modify** `apps/web/lib/data/dashboard.ts` — add `listMyTimelineTasks(userId)`.
- **Modify** `apps/web/app/(app)/dashboard/page.tsx` — personal-home branch renders stats + timeline + upcoming.

---

### Task 1: Award auto-schedules from a site start date

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/tender/actions.ts`, `apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx`

Current `awardTender` (already chains `export_award_to_project` and ends with):
```ts
  revalidatePath(`/boq/${boqId}/tender`);
  if (deliveredProjectId) redirect(`/projects/${deliveredProjectId}/tasks`);
}
```

- [ ] **Step 1: Read the start date in `awardTender`**

Just after the existing `const boqId = String(formData.get('boqId') ?? '');` line at the top of `awardTender`, add:
```ts
  // Optional mobilisation date for the program of works; default = today (win date).
  const startDate = String(formData.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10);
```

- [ ] **Step 2: Chain the scheduler after delivery**

Replace the final two lines of `awardTender` (`revalidatePath(...)` + `if (deliveredProjectId) redirect(...)`) with:
```ts
  // Auto-schedule the generated tasks into a program of works (planned_start/end/due
  // via the forward pass over BOQ durations + dependencies). Best-effort: a schedule
  // failure must not undo the award or the tasks.
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

  revalidatePath(`/boq/${boqId}/tender`);
  if (deliveredProjectId) redirect(`/projects/${deliveredProjectId}/tasks`);
```

- [ ] **Step 3: Add the "Site start date" field to the award form (`comparison.tsx`)**

At the top of the `Comparison` component body add a today string:
```tsx
const todayStr = new Date().toISOString().slice(0, 10);
```
In the award `<form>` (currently `<input hidden tenderId/bidderId/boqId>` + the Award `<Button>`), insert before the button:
```tsx
<label className="flex flex-col gap-0.5 text-[10px] font-normal normal-case text-zinc-500 dark:text-zinc-400">
  Site start date
  <input
    type="date"
    name="startDate"
    defaultValue={todayStr}
    min={todayStr}
    className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-[11px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
  />
</label>
```
(Keep the existing confirm `onSubmit`. Each bidder column has its own form; only the awarded one's `startDate` is used.)

- [ ] **Step 4: Gate** — `pnpm -C apps/web typecheck` clean; `pnpm -C apps/web exec eslint "app/(app)/boq/[boqId]/tender/actions.ts" "app/(app)/boq/[boqId]/tender/comparison.tsx"` → no output.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(app)/boq/[boqId]/tender/actions.ts" "apps/web/app/(app)/boq/[boqId]/tender/comparison.tsx"
git commit -m "feat(programme): award auto-schedules tasks from a site start date"
```
Trailers:
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01D8UBPMHCjka4gQh8NjrA3L

---

### Task 2: Recovery path (`startDelivery`) also schedules

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/tender/actions.ts`, `apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx`

`startDelivery` currently calls `export_award_to_project`, emails, then `redirect(`/projects/${projId}/tasks`)`.

- [ ] **Step 1: Read startDate + schedule in `startDelivery`**

Near the top of `startDelivery`, after the existing `const projectId = String(formData.get('projectId') ?? '');`, add:
```ts
  const startDate = String(formData.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10);
```
After `export_award_to_project` succeeds and `const projId = res.project_id;` is set (BEFORE the delivery-email block or the final redirect), add:
```ts
  // Same program-of-works scheduling as the auto-award path.
  try {
    await supabase.rpc('schedule_boq_tasks', { p_project_id: projId, p_boq_id: boqId, p_start_date: startDate });
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] start-delivery auto-schedule failed (tasks stand):', e);
  }
```

- [ ] **Step 2: Add the date field to the recovery forms (`start-delivery.tsx`)**

Add `const todayStr = new Date().toISOString().slice(0, 10);` in the `StartDelivery` component body. In BOTH the `linkedProject` `<form>` and the new/existing `<form>`, add before their submit buttons:
```tsx
<label className="mb-2 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-300">
  Site start date
  <input type="date" name="startDate" defaultValue={todayStr} min={todayStr}
    className="w-44 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
</label>
```

- [ ] **Step 3: Gate** — typecheck clean; `eslint "app/(app)/boq/[boqId]/tender/actions.ts" "app/(app)/boq/[boqId]/tender/start-delivery.tsx"` → no output.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/app/(app)/boq/[boqId]/tender/actions.ts" "apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx"
git commit -m "feat(programme): recovery start-delivery also schedules the program of works"
```
Trailers as above.

---

### Task 3: `listMyTimelineTasks` data function

**Files:** Modify `apps/web/lib/data/dashboard.ts`

`DashboardTask` (verify the exact interface at the top of the file before writing — match it field-for-field). Known fields: `id, title, status, sla_status, project_id, projectName, assigneeName, planned_start_date, planned_end_date, due_date, actual_end_date`.

- [ ] **Step 1: Add the function** (mirror `getDashboardData`'s row shape, filtered to the caller's assigned tasks, ALL statuses):
```ts
/** The signed-in contractor/member's own assigned tasks as timeline rows — every
 *  status (the Gantt needs done/active/overdue), shaped like getDashboardData rows.
 *  RLS scopes to tasks the caller can read. */
export async function listMyTimelineTasks(userId: string): Promise<DashboardTask[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tasks')
    .select(
      'id, title, status, sla_status, project_id, planned_start_date, planned_end_date, due_date, actual_end_date, projects(name)',
    )
    .eq('assignee_id', userId);

  type Row = {
    id: string; title: string; status: TaskStatus; sla_status: TaskSlaStatus; project_id: string;
    planned_start_date: string | null; planned_end_date: string | null; due_date: string | null;
    actual_end_date: string | null;
    projects: { name: string | null } | { name: string | null }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((t) => {
    const proj = Array.isArray(t.projects) ? t.projects[0] : t.projects;
    return {
      id: t.id, title: t.title, status: t.status, sla_status: t.sla_status,
      project_id: t.project_id, projectName: proj?.name ?? 'Project', assigneeName: null,
      planned_start_date: t.planned_start_date, planned_end_date: t.planned_end_date,
      due_date: t.due_date, actual_end_date: t.actual_end_date,
    } satisfies DashboardTask;
  });
}
```
If `DashboardTask` has FEWER/other fields, adjust the returned object to match exactly (drop `assigneeName`/`actual_end_date` if not on the interface). `TaskStatus`/`TaskSlaStatus` are already imported in this file.

- [ ] **Step 2: Gate** — typecheck clean; `eslint apps/web/lib/data/dashboard.ts` (from repo root: `pnpm -C apps/web exec eslint lib/data/dashboard.ts`) → no output.

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/data/dashboard.ts
git commit -m "feat(programme): listMyTimelineTasks — the caller's tasks as timeline rows"
```
Trailers as above.

---

### Task 4: Personal home shows the timeline + stats + upcoming

**Files:** Modify `apps/web/app/(app)/dashboard/page.tsx`

The personal-home branch (member/contractor/viewer) currently is (~line 153-181): loads `listMyOpenTasks` + `listMyOwed`, renders `<MyTasksCard>` + payments in a `width="3xl"` container.

- [ ] **Step 1: Load timeline tasks**

Add `listMyTimelineTasks` to the dashboard imports (from `@/lib/data/dashboard` — the same module as `getDashboardData`). In the personal branch, extend the `Promise.all`:
```ts
  const [myTasks, myPay, myTimeline] = await Promise.all([
    listMyOpenTasks(ctx.userId),
    listMyOwed(ctx.userId),
    listMyTimelineTasks(ctx.userId),
  ]);
```

- [ ] **Step 2: Derive stat counts**
```ts
  const nowMs = Date.now();
  const tStats = {
    assigned: myTimeline.length,
    inProgress: myTimeline.filter((t) => t.status === 'in_progress').length,
    overdue: myTimeline.filter(
      (t) => t.status !== 'done' && ((t.due_date && new Date(t.due_date).getTime() < nowMs) || t.sla_status === 'breached'),
    ).length,
    done: myTimeline.filter((t) => t.status === 'done').length,
  };
```
(Confirm the exact `TaskStatus` value for in-progress — it may be `'in_progress'`; check `@datumpro/shared/domain`. Use the real literal.)

- [ ] **Step 3: Render stats + timeline + upcoming + payments**

Replace the personal-branch `return (...)` with a `width="6xl"` container:
```tsx
  return (
    <PageContainer width="6xl" className="space-y-8">
      {live}
      <Greeting name={displayName} subtitle={`Your work · ${formatLongDate(new Date())}`} />
      {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Assigned" value={String(tStats.assigned)} />
        <Stat label="In progress" value={String(tStats.inProgress)} />
        <Stat label="Overdue" value={String(tStats.overdue)} tone="amber" />
        <Stat label="Done" value={String(tStats.done)} tone="green" />
      </div>
      <TimelineOverview tasks={myTimeline} unit="task" />
      <MyTasksCard tasks={myTasks} />
      {hasPay && (
        {/* keep the existing My payments card exactly as-is */}
      )}
    </PageContainer>
  );
```
Keep the existing `const hasPay = myPay.summary.earnedCents > 0;` line and the existing "My payments" `<Card>` block verbatim inside the `{hasPay && (...)}`. `TimelineOverview` is already imported at the top of this file; `Stat` and `MyTasksCard` are already in scope. `MyTasksCard` here serves as the "upcoming" list (soonest-due open tasks) — its heading already reads as the task list.

- [ ] **Step 4: Gate** — typecheck clean; `eslint "app/(app)/dashboard/page.tsx"` → no output.

- [ ] **Step 5: Manual check** — as a contractor: personal home shows the 4 stat cards, a task-level Gantt of their assigned tasks (populated once a tender is awarded+scheduled), the task list, and payments; wider layout. As a manager/PM: unchanged.

- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(app)/dashboard/page.tsx"
git commit -m "feat(programme): contractor/personal home shows a task timeline + stats"
```
Trailers as above.

---

## Final verification
- [ ] Move untracked `app/api/admin/{analytics,flags,logs}/` aside; `pnpm -C apps/web typecheck` + `pnpm -C apps/web build` clean; restore them.
- [ ] Manual pass of the spec Testing checklist (award schedules; contractor timeline populates; re-schedule shifts bars).
- [ ] Final code-review subagent over the branch diff; then finish the branch.
