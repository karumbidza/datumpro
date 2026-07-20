# datumpro — Snag Spec 02

Covers: invitation & profile, task fields & dependency alerts, quotation/tender, role-scoped views & blockers.
Companion to `datumpro-project-schema.md`.

---

## 1. Invitation & profile setup

### 1.1 A flag before the schema

You wrote "use ID to create a username." If that means **national ID number**, don't. A username is a semi-public handle — it appears in chat, on tasks, in mentions, in audit logs. National ID numbers are identity-theft material in Zimbabwe and cannot be rotated if leaked.

Recommended split:

| Purpose | Field | Visibility |
|---|---|---|
| Display handle | `username` | public within the org |
| Legal identity / vetting | `national_id` | encrypted, admin-only, never rendered |

Generate the username from the person's **name** at setup, not from any ID number. If you meant the invitation's system UUID — that works fine as the setup token, but it shouldn't become the handle either (unreadable, and it leaks record ordering).

### 1.2 `invitations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid fk | |
| `project_id` | uuid fk nullable | null = org-level invite |
| `email` | citext not null | |
| `phone` | text | WhatsApp fallback matters here — email is unreliable for site contractors |
| `intended_role` | enum | from `project_members.role` |
| `intended_party` | enum | `internal` / `client` / `consultant` / `subcontractor` |
| `permission_level` | enum | |
| `company_name` | text | |
| `token_hash` | text not null | store the **hash**, not the token |
| `expires_at` | timestamptz | 7 days default |
| `status` | enum | `pending`, `opened`, `accepted`, `expired`, `revoked` |
| `opened_at`, `accepted_at` | timestamptz | |
| `invited_by` | uuid fk | |
| `resend_count`, `last_sent_at` | int, timestamptz | rate-limit resends |

Unique partial index: `(org_id, email)` where `status = 'pending'` — stops duplicate live invites.

### 1.3 Setup screen (what the invitee sees)

1. Email pre-filled and locked — it's what was invited
2. **Username** — auto-suggested `firstname.lastname`, collision-resolved with a numeric suffix, editable. Validate `^[a-z0-9._-]{3,30}$`, lowercase, unique per org. Show a live availability tick.
3. Full name, phone
4. **Profile picture** — upload or camera capture, client-side crop to square, resize to 512px, store WebP. Cap 5MB in, ~80KB out. Generate a 96px thumbnail for chat and avatar stacks.
5. Password / OTP per your existing auth
6. Company + trade if `intended_party = 'subcontractor'`

### 1.4 Avatar handling

On `profiles`: `username`, `avatar_url`, `avatar_thumb_url`, `avatar_updated_at`.

- **Fallback:** initials on a colour deterministically hashed from `user_id`. Never a grey silhouette — avatar stacks become unreadable.
- Make the picture optional but prompt on the setup screen, not after. Uptake collapses if it's a later step.
- Serve thumbs from CDN with a long cache and bust via `avatar_updated_at` in the query string.
- Strip EXIF on upload — site photos carry GPS, and so do phone selfies.

Contractors are the group least likely to upload one. Consider letting the PM set an avatar on their behalf during onboarding.

---

## 2. Task fields & dependency alerts

### 2.1 Dates — your correction is right

Two planned dates only:

```
planned_start_date
planned_end_date   ← this IS the due date. No separate field.
```

Plus `actual_start_date` and `actual_end_date`, and the baseline pair. A third "due date" alongside a completion date guarantees they'll disagree within a month.

### 2.2 Additional task fields

| Column | Type | Why |
|---|---|---|
| `trade` | text | plumbing, electrical, blockwork — drives contractor filtering at tender |
| `location_zone` | text | block / floor / room. The single most-requested filter on site |
| `quantity`, `unit` | numeric, text | m², m³, no., sum — links to BoQ |
| `rate`, `budget_cost` | numeric(18,2) | budget vs awarded vs actual |
| `awarded_cost` | numeric(18,2) | populated on award |
| `priority` | enum | `low`/`normal`/`high`/`critical` |
| `is_milestone` | bool | |
| `requires_signoff` | bool | |
| `signoff_role` | enum | who signs: PM, client, engineer |
| `is_weather_sensitive` | bool | feeds the weather blocker and rain-day logic |
| `requires_permit` | bool | links to compliance items |
| `float_days` | int, derived | see below — this is what makes alerts smart |
| `assignment_mode` | enum | `direct` / `tender` / `unassigned` |
| `pct_complete` | int | |
| `last_progress_update_at` | timestamptz | **critical** — silence is the signal |

Also `task_checklist_items` (id, task_id, label, is_done, done_by, done_at) and `task_attachments`.

### 2.3 Float — build this before the alerts

`float_days` = how long a task can slip before it delays the project end. Compute it in the schedule pass alongside dates.

Without float, every delay alert has the same weight and people stop reading them. With it:

- `float_days = 0` → critical path → alert PM + admin immediately
- `float_days 1–3` → alert PM
- `float_days > 3` → alert the assignee only, escalate later

This single field is the difference between a notification system people trust and one they mute.

### 2.4 Time-lapse triggers

Your reasoning is correct: progress-based triggers fail because contractors don't update. So the clock drives everything and updates only ever *cancel* alerts.

`task_alert_rules` — configurable per org, these as defaults:

| Code | Fires when | Recipients |
|---|---|---|
| `predecessor_finishing_soon` | predecessor `planned_end - 2 working days` | successor assignee |
| `successor_starting_soon` | task `planned_start - 2 working days` | assignee |
| `no_update_stale` | `last_progress_update_at` older than 3 working days while task in progress | assignee, then PM at 5 |
| `predecessor_due_today` | predecessor `planned_end`, not complete | predecessor assignee, successor assignee, PM |
| `predecessor_overdue` | predecessor `planned_end + 1`, not complete | + PM, + admin if `float_days = 0` |
| `predecessor_overdue_escalation` | overdue ≥ 3 working days | + admin always |
| `predecessor_complete` | actual completion recorded | successor assignee: "you can start" |
| `successor_start_at_risk` | successor `planned_start` reached, predecessor incomplete | successor assignee, PM |
| `task_overdue` | own `planned_end + 1`, not complete | assignee, PM |
| `quote_deadline_approaching` | RFQ deadline − 24h, no submission | invited contractor |

Notes on implementation:

- **All day-counting uses `add_working_days`.** "Overdue by 2 days" over a Sunday must not fire on Monday morning as if two working days passed.
- **Nudge before you escalate.** `no_update_stale` should ask the contractor to update *before* downstream people are told they're late. Half of apparent delays are just unrecorded completions.
- **A task under an open blocker suppresses overdue alerts** to the assignee, but escalates to the PM instead. The blocker becomes the PM's problem — that's the point of raising one.
- **Deduplicate.** `task_alert_log (task_id, rule_code, recipient_id, fired_for_date)` with a unique constraint. Nothing kills adoption faster than the same alert at 6am every day.
- **Digest, don't spam.** One daily 06:00 digest per user plus immediate push only for `critical` and `float_days = 0` items.
- Run the scan hourly, but gate sends to working hours in the project's timezone.

### 2.5 Estimated vs actual completion

Add `contractor_forecast_end_date` — the assignee can say "I'll finish Thursday" without marking complete. It's a cheap field that surfaces slippage days earlier than any alert rule, because it asks the person who actually knows.

---

## 3. Quotation / tender

### 3.1 Flow

```
Task creation → assignment_mode?
   ├── direct    → pick contractor → task assigned, status = assigned
   ├── tender    → select N contractors, set deadline → RFQ issued
   │                 task.assignee = NULL, task.status = out_to_tender
   └── unassigned→ park it
```

Tender path in full:

1. PM selects contractors (filtered by trade, prior performance, active status)
2. Sets **quote deadline**, scope text, attachments, optional site-visit date, required inclusions
3. Send → one `rfq` + N `rfq_invitations`, each contractor notified
4. Contractor sees: scope, quantity, deadline, and **"this item is out to tender."** They see neither the other invitees' identities nor their quotes.
5. Contractor submits, declines with reason, or stays silent
6. Deadline passes → submissions lock
7. PM opens comparison, awards one, records reason
8. Award assigns the task; unsuccessful contractors are notified automatically

### 3.2 Schema

`rfqs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id`, `task_id` | uuid fk | |
| `reference` | text | `DP-2026-014-RFQ-003` |
| `scope_description` | text | |
| `quantity`, `unit` | numeric, text | |
| `currency` | char(3) | inherited from project |
| `budget_estimate` | numeric(18,2) | **PM-only, never exposed** |
| `deadline_at` | timestamptz | |
| `site_visit_at` | timestamptz nullable | |
| `status` | enum | `draft`, `open`, `closed`, `awarded`, `cancelled`, `retendered` |
| `issued_by`, `issued_at` | | |
| `awarded_to`, `awarded_at`, `awarded_by` | | |
| `award_reason_code` | enum | see below |
| `award_note` | text not null on award | |

`rfq_invitations`

| Column | Type |
|---|---|
| `id`, `rfq_id`, `contractor_id` | uuid |
| `status` | enum: `sent`, `viewed`, `submitted`, `declined`, `no_response`, `withdrawn` |
| `sent_at`, `viewed_at`, `responded_at` | timestamptz |
| `decline_reason` | text |

`rfq_quotes`

| Column | Type | Notes |
|---|---|---|
| `id`, `rfq_id`, `contractor_id` | uuid | |
| `amount` | numeric(18,2) | |
| `currency` | char(3) | |
| `is_vat_inclusive` | bool | |
| `lead_time_days` | int | |
| `earliest_start_date` | date | the availability factor |
| `validity_days` | int | quotes expire |
| `inclusions`, `exclusions` | text | |
| `notes` | text | |
| `attachment_urls` | text[] | |
| `submitted_at` | timestamptz | |
| `revision_no` | int | |
| `superseded_by` | uuid nullable | never overwrite — supersede |

### 3.3 Sealed-bid rules

Enforce in RLS, not just in the UI:

- A contractor may read only their own `rfq_quotes` rows. Ever.
- A contractor may not read `rfq_invitations` rows other than their own — invitee count and identity stay hidden.
- **PM cannot see quote amounts before `deadline_at`.** They can see who has responded. This is the part people skip, and it's the part that makes the audit trail defensible — otherwise nothing stops a figure being passed to a favoured bidder mid-tender.
- No edits after `deadline_at`. Revisions before it create a new row and supersede the old one; the history stays.

If you need an exception for urgent awards, make it an explicit "open early" action that is logged, requires a reason, and is visible on the audit trail. Don't make it silent.

### 3.4 Award reason codes

Free text alone can't be reported on. Use a code plus a mandatory note:

`lowest_price`, `best_availability`, `technical_capability`, `prior_performance`, `only_respondent`, `client_directed`, `existing_framework`, `other`

**Governance rule worth enforcing:** if the awarded quote is not the lowest submitted, require the note and flag it on a report. That's exactly the kind of gap that shows up in a spend audit — the same pattern as spend bypassing a work-order system.

### 3.5 Edge cases to handle now

| Case | Handling |
|---|---|
| No responses by deadline | RFQ → `closed`, prompt PM to extend, re-tender, or assign direct |
| All decline | Same, plus surface the decline reasons |
| Single response | Awardable, but `only_respondent` code applies and it's flagged |
| Quote expires before award | Warn PM; require re-confirmation from contractor |
| Award then contractor withdraws | Revoke award, RFQ → `open`, award runner-up without re-tendering |
| PM cancels tender | Requires reason, all invitees notified |

### 3.6 Audit trail

`rfq_events` — append-only, no updates, no deletes: `rfq_id`, `event_type`, `actor_id`, `actor_role`, `payload` jsonb, `occurred_at`.

Log: issued, invitation sent, viewed, quote submitted, quote revised, declined, deadline extended (+reason), quotes opened, award made (+code +note), unsuccessful notified, cancelled.

Render it as a read-only timeline on the task. This is the artefact a client or auditor asks for, and it's cheap to build if you write events from day one — and near impossible to reconstruct later.

### 3.7 Award side effects

On award: set `task.assignee`, `task.awarded_cost`, status → `assigned`; notify winner and losers; optionally generate a work order / PO. Keep `budget_cost` alongside `awarded_cost` so variance reporting works from the start.

---

## 4. Role-scoped views & blockers

### 4.1 The visibility question

You've identified that a PM currently sees contractor-only controls — "submit for sign-off," "raise blocker." Three options:

| Option | Verdict |
|---|---|
| Hide from PM entirely | Wrong. PM loses awareness of what's pending |
| Show disabled with a tooltip | Better, but frustrating in practice |
| **Show as read-only status + explicit act-on-behalf** | Recommended |

The third is right because of the problem you already named: contractors don't update the system. PMs *will* need to mark things complete on someone's behalf. Rather than pretend otherwise, make it a first-class, logged action.

**Contractor's task panel:** `Update progress` · `Submit for sign-off` · `Raise blocker` · `Upload evidence`

**PM's task panel, same area, different treatment:**

```
Contractor actions          — status strip, read-only
  Progress            60% · updated 4 days ago ⚠
  Sign-off            not submitted
  Blockers            1 open  →  [Review]

[ Act on behalf ▾ ]    ← logged, reason required
```

Every act-on-behalf writes `performed_by`, `on_behalf_of`, `reason` to the audit log and shows a badge on the task: *"Marked complete by A. Muzamba on behalf of Chikaka Plumbing."* Everyone stays honest, and the data stays usable.

### 4.2 `task_blockers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `task_id`, `project_id` | uuid fk | |
| `type` | enum | see taxonomy |
| `blocking_task_id` | uuid fk nullable | required when type = `predecessor_incomplete` |
| `related_record_type` / `related_record_id` | text / uuid | invoice, RFQ, permit, RFI |
| `description` | text not null | |
| `evidence_urls` | text[] | photos matter for weather and breakdowns |
| `estimated_impact_days` | int | contractor's estimate |
| `actual_impact_days` | int | filled on resolution |
| `severity` | enum | `low`/`medium`/`high` — auto-set `high` if task float = 0 |
| `raised_by`, `raised_at` | | |
| `status` | enum | `open`, `acknowledged`, `in_progress`, `resolved`, `rejected` |
| `owner_id` | uuid fk | who must clear it — often the PM, not the raiser |
| `acknowledged_at`, `resolved_at` | | |
| `resolution_note` | text | required to resolve |
| `creates_calendar_exception` | bool | links weather/shutdown blockers to EOT evidence |

### 4.3 Blocker taxonomy

Grouped, because a flat list of 15 kills the mobile form:

**Dependency** — `predecessor_incomplete`, `pending_approval`, `awaiting_inspection`, `design_info_missing` (RFI)

**Commercial** — `payment_due`, `variation_not_approved`, `quote_not_awarded`

**Resources** — `materials_unavailable`, `delivery_delayed`, `plant_breakdown`, `labour_shortage`

**Site & external** — `weather`, `site_access_denied`, `utility_outage`, `permit_not_issued`, `safety_stop`, `client_instruction`

**`other`** — free text mandatory

Two behaviours that make the taxonomy pay off:

- **Auto-populate the link.** `predecessor_incomplete` pre-fills `blocking_task_id` from the dependency graph. `payment_due` offers the open invoices. Contractors won't hunt for record numbers.
- **`weather` and `site_access_denied` auto-propose a calendar exception** for the PM to approve. That's your extension-of-time evidence assembling itself, tied straight into `project_calendar_exceptions`.

### 4.4 Blocker behaviour

- Task gains a visible `is_blocked` state; overdue nags to the assignee are suppressed while open
- **Escalation clock**: unacknowledged after 24h → PM; 48h → admin. A blocker nobody acknowledges is worse than no blocker
- Resolving requires a note and `actual_impact_days`
- Rejecting requires a reason and notifies the raiser
- A blocker on a zero-float task alerts PM and admin immediately regardless of type
- Project dashboard: open blockers by type. After a month this tells you whether your delays are weather, money, or your own approvals — and that's the most valuable report in the whole app

---

## 5. Open questions

1. **"Use ID to create a username"** — did you mean national ID, or the invitation token? My recommendation above assumes name-derived usernames; confirm before it's built.
2. **Contractor identity across projects** — is a contractor an org-level record reusable on every project (recommended, enables performance history and trade filtering), or per-project?
3. **PM sight of quotes before deadline** — do you want the hard block, or the logged "open early" exception?
4. **Act-on-behalf permission** — PM only, or admin too? And should the contractor be notified when it happens? I'd say yes to notification.
5. **Notification channels** — email plus in-app, or WhatsApp/SMS as well? For Zimbabwean site contractors, WhatsApp is realistically the only channel with reliable read rates, and it changes the notification architecture, so decide early.
