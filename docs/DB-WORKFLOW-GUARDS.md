# DB workflow guards — writing `plan_approved_at` and other protected columns

**Read this before writing any function or trigger that updates a "workflow outcome"
column** (a plan approval, a variation decision, an extension decision). Getting it
wrong produces a runtime error that CI's happy-path checks often miss.

## The symptom

```
ERROR:  protected workflow column(s) [plan_approved_at] on tasks may change only
        via an approved transition
CONTEXT: PL/pgSQL function public.guard_workflow_transition() ...
```

If you hit this, your code changed a guarded column without declaring itself a
vetted transition. Read on.

## What is guarded

`guard_workflow_transition()` (migration `20260826000002_phase1_workflow_transition_guard.sql`)
is a `BEFORE UPDATE` trigger on three columns. A guarded column may only **change**
when the transaction-local GUC `app.workflow_ctx` equals the row's `org_id`:

| Table                          | Column             | Trigger                       |
|--------------------------------|--------------------|-------------------------------|
| `tasks`                        | `plan_approved_at` | `trg_guard_plan_approval`     |
| `task_subtasks`                | `variation_status` | `trg_guard_variation_status`  |
| `task_extension_requests`      | `status`           | `trg_guard_extension_status`  |

Why: it stops a client (even the service role, even a direct PostgREST `PATCH`)
from self-approving a plan/variation/extension. PostgREST can't set a per-request
GUC, so only a `SECURITY DEFINER` RPC that deliberately sets `app.workflow_ctx`
can move these columns. `INSERT`s are **not** guarded — only value *changes* on
`UPDATE`.

## The contract for a new writer

If your `SECURITY DEFINER` function legitimately writes a guarded column, resolve
the row's `org_id` and set the GUC **before** the write:

```sql
create or replace function public.my_new_rpc(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''            -- pin it (all refs must be schema-qualified)
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.tasks where id = p_task_id;
  -- ... your auth / precondition checks ...

  perform set_config('app.workflow_ctx', v_org::text, true);   -- <-- the key line
  update public.tasks
     set plan_approved_at = now()
   where id = p_task_id;
end;
$$;
```

`set_config(..., true)` makes it transaction-local, so it clears itself at
commit/rollback. `finalize_approval` sets the same GUC via a trigger; direct RPCs
set it inline (as above).

## Vetted writers today

Keep this list current when you add one:

- `finalize_approval` — the approvals engine (sets the GUC in a trigger)
- `export_award_to_project` — tender award → project export (REPRICE mode approves the generated tasks) — fixed in `20260826000009`
- `award_tender` — per-task tender award — fixed in `20260826000010`
- `accept_and_price_task` — whole-task pricing accept/lock — `20260826000011`

## Don't rely on CI's happy path

A new writer that never runs in `supabase/tests/rls_security.sql` will pass CI even
though it's broken at runtime. **When you add a guarded-column writer, add a call to
it in `rls_security.sql`** — every current writer has a regression test there. That
suite gates the `DB security (RLS regression)` check.

Note: `app.tender_award` is a *different, older* GUC (it tells the reassignment
cleanup trigger to preserve a task's plan during award). It is **not** read by this
guard — setting it does not satisfy `guard_workflow_transition`. You still need
`app.workflow_ctx`.
