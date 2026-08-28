# DB ledger protection — "never delete the money or the audit trail"

Real financial figures and the audit trail are permanent. They are the record
that gets exported to accounting / Excel, so they must survive for audit and can
never be deleted out from under a project. This is enforced in the database, not
just the UI, by `BEFORE DELETE` / `BEFORE UPDATE` triggers (migration
`20260826000020_ledger_delete_protection.sql`).

## What is protected

Only **committed** money and the **audit trail** are frozen. Draft / working data
stays freely editable so estimating and tender award keep working.

| Table | Rule |
|---|---|
| `audit_logs` | append-only — no DELETE, no UPDATE |
| `task_activity` | append-only — no DELETE, no UPDATE |
| `contractor_payment_requests` | never deleted (any status); withdrawal is a status change to `cancelled` |
| `tasks` | no DELETE once `plan_approved_at` is set or `awarded_cost_cents > 0` |
| `task_subtasks` | no DELETE when `variation_status = 'approved'` (an approved additional-works figure) |
| `variation_orders` | no DELETE when `status = 'approved'` (legacy table, defensive parity) |

Not protected (deliberately):

- **Draft data** — BOQ estimates, unapproved plan lines, losing tender bids, and
  not-yet-committed tasks stay deletable. The RPCs that delete `task_subtasks`
  (`award_tender`, reassign/decline, `export_award_to_project`/reprice) only ever
  remove draft/losing rows, never an approved variation, so they are unaffected.
- **`approvals`** — working approval-chain state that is legitimately reset on plan
  resubmit (`seed_task_plan_approvals` clears the stale chain). The permanent
  record of every decision lives in `audit_logs`.
- **`approval_policies`** — configuration, rebuilt wholesale by
  `set_org_approval_matrix` / `set_org_approval_policy`.

## Cascade deletes are covered for free

A `BEFORE DELETE` trigger fires even when a row is removed via `ON DELETE
CASCADE`. So deleting a **project** or **organization** that has committed money or
audit history aborts the whole statement — you cannot erase the ledger indirectly.
An empty, draft-only project stays deletable. No foreign-key surgery was needed.

## Withdrawal keeps the row

A contractor withdrawing a still-pending payment request is a status change
`requested → cancelled` (`payment_request_status` gained `cancelled` in
`20260826000019`). `enforce_payment_request_update` permits the owning contractor
to make exactly that transition (no money fields may change) and treats
`cancelled` as terminal. The amount stays on record; `cancelled` requests are
excluded from claimable/pending aggregates.

## Contract for new writers

- **Adding a money column or a new financial table?** Decide whether it holds a
  committed figure. If so, add a `BEFORE DELETE` guard here (conditional on the
  committed marker, so drafts stay editable), and a regression case in
  `supabase/tests/rls_security.sql` that seeds a committed row, attempts the
  delete, and asserts it is rejected (`insufficient_privilege`) with the row still
  present. The suite gates the `DB security (RLS regression)` CI check.
- **Never** work around a guard by deleting through a `SECURITY DEFINER` RPC — the
  triggers fire there too, by design. If a legitimate flow needs to remove a
  *draft* row, make the guard condition exclude it rather than bypassing the guard.
