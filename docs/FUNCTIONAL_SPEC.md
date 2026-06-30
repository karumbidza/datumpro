# DatumPro — functional specification

How the product works for each user, and the logic that drives it. This is the
agreed reference; build decisions trace back here. (Architecture/security live in
`ARCHITECTURE.md`.)

## Roles → construction personas

| Role | Persona | Core responsibilities |
|---|---|---|
| **Owner / Admin** | Director / project director | Org & members, billing, approval policies, final oversight |
| **PM** | Project / site manager | Plan projects, create + assign **tasks**, approve work sign-offs, resolve blockers, approve variations |
| **Finance** | QS / accounts | Budget/BOQ, invoices, payments + POP verification, Paynow |
| **Member** | Contractor / engineer / site team | Do assigned tasks, capture site reports + photos, raise blockers & requests, submit work for sign-off |
| **Viewer / Client** | Client / stakeholder | Read-only dashboards & progress |

## Core objects & lifecycles

### Task (the work engine)
```
TODO → IN_PROGRESS → SUBMITTED (awaiting sign-off) → DONE
                  ↘ BLOCKED ↗
```
- **Assignment:** one assignee. Unassigned at its planned start → auto-`BLOCKED` + PM alerted.
- **SLA health (full — decision B):** `on_track → at_risk → breached`, plus `pending_signoff`, `blocked`, `resolved_on_time/late`. Warnings at 24h & 2h; breach at due date; daily overdue digest to PMs. Contractor scoring is a **later** add-on.
- **Blockers:** assignee raises (reason + photo) → `BLOCKED`, **SLA clock pauses**; a lead resolves → resumes and the **deadline is credited** by the blocked duration.
- **Dependencies:** predecessor→successor with **lag days**; a successor unlocks once all predecessors are `DONE` (+lag). Circular dependencies are rejected.
- **Sign-off (decision C — mandatory photo):** assignee submits completion (**notes + ≥1 photo + declaration**) → only a **PM/Admin/Owner** can approve to `DONE` or reject (→ back to `IN_PROGRESS`). The DB blocks anyone else from setting `DONE`.

### Site report — periodic field progress (progress %, narrative, weather, GPS, media); offline-captured.
### Request — RFI / purchase / variation / access → approval chain (requester ≠ approver).
### Finance — budget/BOQ → invoices → payments → POP → variations.

## End-to-end journeys

1. **Setup** (Admin): create org, invite team, set roles + approval policies.
2. **Plan** (PM): project + budget/BOQ → milestones → **tasks** (assign, dates, dependencies).
3. **Execute** (Member): start task → log site reports/photos → raise blocker if stuck → submit for sign-off.
4. **Oversee / remote-monitor** (PM/Admin): live dashboards, SLA/blocker alerts, approve sign-offs, resolve blockers, approve variations. *(Core product pitch.)*
5. **Bill & collect** (Finance): milestone/task completion → raise invoice → client pays (Paynow) / uploads POP → finance verifies → budget-vs-actual updates.

## Automation logic
- Auto-start tasks at planned date; auto-block unassigned ones.
- Blocker pauses the SLA clock and **extends the deadline** by the blocked time.
- Dependency completion unlocks successors (+lag).
- SLA escalation: 24h/2h warnings → breach → daily overdue digest.
- Approvals materialise from policy; requester ≠ approver (enforced in DB).

## Cross-module links (decision D — progress billing)
- A **milestone/task completion** can mark a **payment-schedule draw** ready to invoice (progress billing). Phased in **after** the task engine.
- An approved **variation request** → writes a `variation_order` that adjusts the budget.
- Task cost can roll up to a **budget line** (budget vs actual).

## Build order (revised)
1–3. ✅ Foundation, monitoring, finance, requests/approvals (schemas done & validated).
4. **Task engine** ← next: tasks, dependencies, blockers, SLA fields, photo sign-off.
5. Cross-links: task/milestone → payment-schedule draw; variation request → variation order.
6. Offline mobile (Expo + PowerSync); UI; Paynow + Inngest jobs; notifications.
