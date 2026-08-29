# BOQ subtasks are original scope (not variations) + contractor task-panel reflow

**Date:** 2026-08-29
**Status:** Approved (design)
**Branch:** `fix/boq-subtask-scope-and-task-panel-ui` (off `main`)

## Problems

**1. Original BOQ scope shows as "Additional works" (pending variations).** On the contractor task panel, a BOQ task's own line items (e.g. `1.1.1 mobilisation`) render under "Additional works" with a PM→Finance approval chain and a *Pending* badge. Root cause: the BEFORE-INSERT trigger `set_subtask_variation_flag` (`20260101005200`) marks any subtask inserted into a task whose `plan_approved_at` is already set as a variation (`is_variation=true, variation_status='pending'`). `export_award_to_project` / `generate_tasks_from_boq` pre-approve the plan *before* inserting the BOQ subtasks, so every generated line is mis-flagged. Confirmed on prod: task `cdd92611…` subtasks are `is_variation=true, variation_status='pending', boq_item_id NOT NULL`.

**Model (confirmed):** BOQ-awarded subtasks = the task's **approved original scope** (`is_variation=false`). "Variations" = only genuine extras a contractor adds *after* the plan is approved (via "Request additional works").

**2. Task-panel layout.** Contractor wants: submit/blocker buttons at the very bottom; "Attach invoice" (drop "BoQ"; optional) just above them; the scope subtasks full-width; and the "Request an extension" link beside the "Can't complete this task? Hand back" link at the bottom.

## Part 1 — Variation-flag fix (migration `20260826000027`)

All in `supabase/migrations/20260826000027_boq_subtasks_baseline_not_variation.sql`.

### 1a. Trigger: skip variation-flagging on vetted generation
Vetted generation RPCs (`export_award_to_project`, `generate_tasks_from_boq`, the reprice path) already `set_config('app.workflow_ctx', <org>, true)` before inserting subtasks. Redefine `set_subtask_variation_flag` so that when `app.workflow_ctx` is set, the insert is BASELINE regardless of plan state:
```sql
create or replace function public.set_subtask_variation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approved timestamptz; v_submitted timestamptz;
begin
  -- Vetted generation (award/export/reprice/finalize) sets app.workflow_ctx and
  -- inserts the task's BASELINE scope even though the plan is already approved —
  -- these are never variations. User-added subtasks (no workflow_ctx) still flag.
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
```
Trigger binding unchanged (replace function only). No genuine-variation path sets `workflow_ctx` (variations come from the user `addSubtask` action), so the bypass is safe.

### 1b. Backfill mis-flagged BOQ scope
BOQ-sourced subtasks wrongly flagged as pending variations = original scope. Flip them, drop their seeded variation approval chains, and recompute the parent tasks' `awarded_cost_cents` (baseline sum). Guard the whole migration with `set_config('app.workflow_ctx', ...)` is NOT needed here (direct UPDATE, no INSERT trigger). Steps:
```sql
-- affected subtasks: from a BOQ line, currently a pending/rejected variation
create temporary table _fix on commit drop as
  select id, task_id from public.task_subtasks
  where boq_item_id is not null and is_variation = true and variation_status <> 'approved';

-- drop the variation approval chains seeded for them
delete from public.approvals
  where entity_type = 'task_variation' and entity_id in (select id from _fix);

-- flip to baseline scope
update public.task_subtasks
  set is_variation = false, variation_status = null
  where id in (select id from _fix);

-- recompute awarded_cost_cents for the affected tasks (baseline + approved sum)
update public.tasks t
  set awarded_cost_cents = coalesce((
    select sum(s.cost_cents) from public.task_subtasks s
    where s.task_id = t.id and (s.is_variation = false or s.variation_status = 'approved')), 0)
  where t.id in (select distinct task_id from _fix);
```
Idempotent: re-running matches nothing (already `is_variation=false`).

### 1c. Test
Add a `supabase/tests/rls_security.sql` assertion (or a dedicated suite) proving: with `app.workflow_ctx` set, a subtask inserted into a plan-approved task is `is_variation=false`; without it, the same insert is `is_variation=true`.

## Part 2 — Task-panel reflow (`apps/web/components/task/subtask-panel.tsx`)

Current lower-panel order: plan subtasks → DocAttach → completion media → **Submit/Blocker buttons** → 2-col grid (**variations "Additional works"** | **Extension of time**) → "Can't complete? Hand back" link. Reflow to:

1. **Plan/scope subtasks — full width** (already the plan checklist; after Part 1 the BOQ scope lands here, headed "Task plan", not "Additional works").
2. **Variations ("Additional works") — full width** (drop the `sm:grid-cols-2` that squeezed it): shows only genuine extras now, plus "+ Request additional works".
3. **Attach invoice** — the `DocAttach` block, moved to just above the buttons; relabel its heading/label from "BoQ / invoice" / "Attach BoQ / invoice" → "Attach invoice" (drop BoQ). Sign-off stays possible with no invoice (the attach is optional — unchanged).
4. **Submit for sign-off · Raise a blocker** — the two buttons, at the **very bottom** of the action stack.
5. **Footer links row** — "Can't complete this task? Hand back" and "Request an extension (needs approval)" **side by side** at the very bottom (extract the extension link out of the old 2-col grid to sit next to the hand-back link).

Only layout/label/order changes — no change to the submit/blocker/extension/variation *actions* or their gating (`planComplete`, `canWorkflow`, `canRequestExtension`, etc. unchanged). The "Attach BoQ / invoice" wording lives in `doc-attach.tsx`; update its label there.

## Error / edge handling
- Migration idempotent; trigger replace keeps the binding.
- A task with genuine variations (none from BOQ) is untouched by the backfill (`boq_item_id is not null` guard).
- `awarded_cost_cents` recompute uses the same baseline+approved filter the rest of the app uses — keeps payment entitlement consistent.
- UI: buttons keep their `disabled`/gating; no invoice required for sign-off.

## Testing
Gates: `pnpm -C apps/web typecheck` + `eslint`; `next build`; CI DB-security replays `…027` + runs suites. Manual: on the Magunje contractor task, the BOQ lines now show as the **task plan** (checkable), not pending "Additional works"; "Additional works" is empty until a real variation is requested; buttons at the bottom; "Attach invoice" above them; extension link beside hand-back.

## Out of scope
- Reworking the variation approval flow itself. Mobile task screen (web only). The generation RPCs' other behaviour (only the trigger changes; the RPCs already set `workflow_ctx`, so they need no edit).
