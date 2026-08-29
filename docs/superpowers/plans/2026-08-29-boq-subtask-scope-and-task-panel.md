# BOQ Subtask Scope Fix + Task-Panel Reflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** BOQ-awarded subtasks render as the task's approved scope (not pending "Additional works"), and the contractor task panel is reflowed (full-width scope, Attach invoice above bottom buttons, extension link beside hand-back).

**Architecture:** A migration fixes the `set_subtask_variation_flag` trigger to skip vetted-generation inserts (which set `app.workflow_ctx`) + backfills mis-flagged rows. A layout-only pass reorders `subtask-panel.tsx`.

**Branch:** `fix/boq-subtask-scope-and-task-panel-ui` (spec committed).

**No test harness** for the client component. Gates: `pnpm -C apps/web typecheck` + `eslint`; CI DB-security replays the migration + runs `supabase/tests/*.sql`.

**Guardrails:** NEVER `git add -A` (untracked `app/api/admin/*`). Number the migration off the latest main (`…027`); `ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | uniq -d` must be empty. `noUncheckedIndexedAccess` ON; `react-hooks/exhaustive-deps` enabled (warn).

---

### Task 1: Migration — BOQ subtasks are baseline scope

**Files:** Create `supabase/migrations/20260826000027_boq_subtasks_baseline_not_variation.sql`; Modify `supabase/tests/rls_security.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ-generated subtasks are BASELINE scope, not variations
--
-- set_subtask_variation_flag (20260101005200) flags any subtask inserted into a
-- plan-approved task as a variation. But export_award_to_project /
-- generate_tasks_from_boq pre-approve the plan BEFORE inserting the BOQ lines, so
-- a task's own scope was mis-flagged is_variation=true / 'pending' and shown as
-- "Additional works" awaiting PM→Finance approval. Vetted generation sets
-- app.workflow_ctx; when it's set the insert is baseline regardless of plan state.
-- Then backfill the rows already mis-flagged.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_subtask_variation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approved timestamptz; v_submitted timestamptz;
begin
  if coalesce(nullif(current_setting('app.workflow_ctx', true), ''), '') <> '' then
    new.is_variation := coalesce(new.is_variation, false);
    if not new.is_variation then new.variation_status := null; end if;
    return new;
  end if;
  select plan_approved_at, plan_submitted_at into v_approved, v_submitted
    from public.tasks where id = new.task_id;
  if v_approved is not null then
    new.is_variation := true; new.variation_status := 'pending';
  elsif v_submitted is not null then
    raise exception 'The plan is awaiting approval and cannot be changed right now';
  else
    new.is_variation := false; new.variation_status := null;
  end if;
  return new;
end $$;

-- Backfill: BOQ-sourced subtasks wrongly flagged as pending/rejected variations.
create temporary table _fix on commit drop as
  select id, task_id from public.task_subtasks
  where boq_item_id is not null and is_variation = true and variation_status <> 'approved';

delete from public.approvals
  where entity_type = 'task_variation' and entity_id in (select id from _fix);

update public.task_subtasks
  set is_variation = false, variation_status = null
  where id in (select id from _fix);

update public.tasks t
  set awarded_cost_cents = coalesce((
    select sum(s.cost_cents) from public.task_subtasks s
    where s.task_id = t.id and (s.is_variation = false or s.variation_status = 'approved')), 0)
  where t.id in (select distinct task_id from _fix);
```
> NOTE: verify the seeded-approval table/column names against `20260101005200` (`seed_approval_steps('task_variation', …)`). If it writes to `public.approval_steps` (not `public.approvals`), delete from the correct table. Check before finalizing.

- [ ] **Step 2: Add a test to `supabase/tests/rls_security.sql`**

Inside the existing rolled-back `begin … rollback` block, add an assertion: create a task with `plan_approved_at = now()`, then (a) with `select set_config('app.workflow_ctx','<org>',true)` insert a subtask → assert `is_variation = false`; (b) `select set_config('app.workflow_ctx','',true)` (clear) then insert another → assert `is_variation = true`. Use the file's `pg_temp.ok(...)` harness and existing seed rows/ids.

- [ ] **Step 3: Confirm no duplicate migration numbers**

Run: `ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | uniq -d` — Expected: empty.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260826000027_boq_subtasks_baseline_not_variation.sql supabase/tests/rls_security.sql
git commit -m "fix(task): BOQ-generated subtasks are baseline scope, not pending variations"
```
Trailers:
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01D8UBPMHCjka4gQh8NjrA3L

---

### Task 2: Contractor task-panel reflow

**Files:** Modify `apps/web/components/task/subtask-panel.tsx`, `apps/web/components/task/doc-attach.tsx`.

Current lower-panel order (subtask-panel.tsx): plan subtasks (~499-700) → `<DocAttach …>` (~721) → completion media (~726) → Submit/Blocker buttons (~767-786) → 2-col grid `sm:grid-cols-2` (~798) holding the variations "Additional works" column (~800-895) and the Extension-of-time column (~896-960, includes the "+ Request an extension" link ~906 and the "Can't complete this? Hand the task back" link ~950) .

- [ ] **Step 1: Relabel the attach control (`doc-attach.tsx`)**

Change the heading/button wording from "BoQ / invoice" and "Attach BoQ / invoice" to **"Invoice"** and **"Attach invoice"** (drop "BoQ"). Do not change its upload behaviour or the `optional` nature. (Find the exact strings in `doc-attach.tsx`.)

- [ ] **Step 2: Make the variations block full width**

In subtask-panel.tsx, change the wrapper `<div className="mt-4 grid gap-x-6 gap-y-4 border-t … sm:grid-cols-2">` so it is NOT a 2-column grid — the variations ("Additional works") block spans the full width. Split the Extension-of-time / hand-back links out of this grid into their own footer row (Step 4).

- [ ] **Step 3: Reorder — Attach invoice, then the buttons, at the bottom**

Move the `<DocAttach …>` block (~721) and the Submit/Blocker button row (~767-786) so they render **after** the (now full-width) variations block, in this order: variations → DocAttach (Attach invoice) → Submit/Blocker buttons. Keep the completion-media block where it makes sense (below the buttons or with the attachments — keep its existing position relative to the buttons). Do NOT change the button gating (`planComplete`, `canWorkflow`) or the DocAttach props.

- [ ] **Step 4: Footer links row — extension beside hand-back**

At the very bottom, render a single row containing BOTH the "Can't complete this task? Hand the task back" link (~950) and the "+ Request an extension (needs approval)" link (~906) side by side (e.g. `<div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t … pt-4">`). Preserve each link's existing onClick/action and gating (`canRequestExtension`, the hand-back handler). Remove them from the old grid columns.

- [ ] **Step 5: Gate**

Run: `pnpm -C apps/web typecheck` (per admin-noise rule) and `pnpm -C apps/web exec eslint "components/task/subtask-panel.tsx" "components/task/doc-attach.tsx"` → no output.

- [ ] **Step 6: Manual check** — contractor task panel: scope subtasks full-width as the plan checklist; "Additional works" (variations) only shows genuine extras; "Attach invoice" sits just above the two bottom buttons; Submit/Blocker at the very bottom; the hand-back and request-extension links sit together in a footer row. Sign-off works with no invoice attached.

- [ ] **Step 7: Commit**
```bash
git add "apps/web/components/task/subtask-panel.tsx" "apps/web/components/task/doc-attach.tsx"
git commit -m "feat(task): contractor panel reflow — full-width scope, Attach invoice above bottom actions, extension beside hand-back"
```
Trailers as above.

---

## Final verification
- [ ] Move untracked `app/api/admin/*` aside; `pnpm -C apps/web typecheck` + `build` clean; restore.
- [ ] Dispatch a review subagent over the branch diff (esp. the trigger bypass safety + backfill correctness).
- [ ] After merge: deploy `…027` to prod (explicit approval), then backfill applies to existing tasks (incl. `cdd92611`).
