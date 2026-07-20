# Claude Code Handover B — Tasks, Dependency Alerts & Tendering

Scope: task field expansion, date correction, float calculation, time-lapse alert engine, RFQ/tender flow.

**Run after Handover A.** This depends on contractor records and role resolution being in place.

> Attach `datumpro-snag-spec-02.md` to the session or place it at `docs/snag-spec-02.md`.

---

## Prompt

I'm extending the task and tendering system in this codebase. **Do not scaffold new infrastructure.** Scheduling, notifications, and data access patterns may already exist here — find them before you build.

Read `docs/snag-spec-02.md` sections 2 and 3 for target behaviour. Specification of intent, not a migration to run verbatim.

### Phase 0 — Audit before writing anything

Do not write code yet. Report back with file paths and line references:

1. **Task schema as it stands** — every column, type, constraint, index. Specifically list **all date fields** and where each is written and read.
2. **The three dates** — the task setup form currently collects three dates. Identify exactly which fields these are, every place each is consumed, and what breaks if the redundant "due date" is removed. This is the highest-risk change in this handover; I want it mapped before anything moves.
3. **Dependencies** — does any dependency or predecessor relationship exist? What type (FS/SS/FF/SF)? Is there any scheduling or date-cascade logic?
4. **Working-day logic** — is `add_working_days` present, or any TypeScript date utility? Where does date maths currently live, DB or app?
5. **Notification infrastructure** — tables, send mechanism, channels configured, background job runner, cron capability. Be specific about what can and cannot run on a schedule today.
6. **Contractor records** — how are contractors stored after Handover A? Org-level or per-project? What identifies trade?
7. **Any existing quote, tender, or procurement code** — including partial or abandoned work.
8. **RLS patterns** — show me a representative policy. The tender feature depends on row-level enforcement and I need to see the house style.
9. **Gap analysis** — table: `exists, reuse as-is` / `exists, needs extension` / `missing, must create`.
10. **Risks** — anything that breaks existing records, queries, or generated types.

Stop after this and wait for my sign-off.

### Phase 1 — Task fields & date correction

**Additive migrations first.** Then the date change as its own separate, reversible commit.

Date model — two planned dates only:
```
planned_start_date
planned_end_date    ← this IS the due date
actual_start_date
actual_end_date
```
Remove the redundant third date. Migrate its data into `planned_end_date` where that is null, report any rows where the two disagreed rather than silently picking one, and update every consumer you found in Phase 0.

New fields per spec §2.2: `trade`, `location_zone`, `quantity`, `unit`, `rate`, `budget_cost`, `awarded_cost`, `priority`, `is_milestone`, `requires_signoff`, `signoff_role`, `is_weather_sensitive`, `requires_permit`, `float_days`, `assignment_mode`, `last_progress_update_at`, `contractor_forecast_end_date`.

Plus `task_checklist_items` and `task_attachments` if not already present.

Keep the task form usable — group these into collapsible sections (Schedule / Commercial / Requirements). Do not render 20 fields in a flat column.

### Phase 2 — Dependencies & float

- Dependency table with `predecessor_id`, `successor_id`, `type` (FS/SS/FF/SF), `lag_days`
- Cycle detection on write — reject, with a clear message naming the tasks in the cycle
- Forward/backward pass computing `float_days` per task
- All date arithmetic goes through the working-day calendar. Tell me whether you're calling the DB function or a TS utility, and make it **one** of those, not both

`float_days` gates alert severity, so it must be correct before Phase 3.

### Phase 3 — Time-lapse alert engine

Triggers fire on **elapsed time, not reported progress**. Progress updates only ever cancel or downgrade alerts. Rules per spec §2.4.

Non-negotiables:
- All day counting uses working days — "overdue by 2 days" must not fire Monday for a Friday deadline over a Sunday
- `task_alert_log (task_id, rule_code, recipient_id, fired_for_date)` with a unique constraint. Repeat alerts for the same condition on the same day are a bug
- Nudge the assignee to update *before* escalating downstream. Most apparent delays are unrecorded completions
- An open blocker suppresses overdue alerts to the assignee and escalates to PM instead
- Severity by float: `0` → PM + admin immediately; `1–3` → PM; `>3` → assignee only
- Daily 06:00 digest per user; immediate push reserved for critical and zero-float items
- Scan hourly, send only within project working hours
- Rules configurable per org — thresholds in a table, not hardcoded

Reuse the existing notification and job infrastructure. If no scheduler exists, stop and propose options rather than adding one unasked.

### Phase 4 — Tendering

Task creation gains `assignment_mode`: `direct` → pick contractor and assign; `tender` → RFQ flow; `unassigned` → park.

Tables per spec §3.2: `rfqs`, `rfq_invitations`, `rfq_quotes`, `rfq_events`.

**Sealed-bid rules, enforced in RLS and not only in the UI:**
- A contractor reads only their own quote rows
- A contractor cannot read other invitation rows — invitee count and identity stay hidden
- Contractors see that the item is out to tender, the scope, and the deadline. Nothing about competitors
- **PM cannot read quote amounts before `deadline_at`** — only who has responded. Implement this as a policy, not a conditional render
- No submissions or edits after the deadline. Pre-deadline revisions create a new row and supersede the prior one; never overwrite
- `budget_estimate` on the RFQ is PM-only and must never reach a contractor-facing query

Award:
- Mandatory `award_reason_code` + note
- If the awarded quote is not the lowest submitted, require the note and flag it for reporting
- On award: set assignee, `awarded_cost`, status → `assigned`; notify winner and unsuccessful bidders
- Keep `budget_cost` alongside `awarded_cost` for variance reporting

Edge cases from spec §3.5 — no responses, all declined, single response, quote expired before award, contractor withdraws after award, PM cancels. Handle all seven; don't leave dead-end states.

`rfq_events` is **append-only**: no updates, no deletes, enforced at the database level. Render it as a read-only timeline on the task.

### Working rules

- **Small commits, one concern each.** The date removal gets its own commit with a documented rollback.
- Regenerate types after migrations using the repo's existing command.
- No new dependencies without asking — especially any scheduling or graph library. Name it, say what it replaces, wait.
- If existing code already does something in the spec, use it and tell me.
- Where the spec conflicts with an established repo pattern, **the repo pattern wins** — flag it, don't silently follow the doc.
- Write the RLS policy tests. For sealed bids I want to see a failing query proving a contractor cannot read another's quote, not an assurance that they can't.

### Out of scope

Invitations, avatars, blocker CRUD, act-on-behalf — those are Handover A. Purchase orders, valuations, retention. Consume blockers for alert suppression; don't rebuild them.

Start with Phase 0.
