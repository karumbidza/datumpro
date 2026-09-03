# DatumPro — Demo Environment & Walkthrough

> **Company:** Meridian Construction (Pvt) Ltd — a fictional Zimbabwean contractor.
> This dataset was seeded for demos. It exercises the full flow across three projects
> at different stages, with the complete role-based team.
>
> ⚠️ This is the **live** Supabase project (`datumpro.app` + the mobile app). The demo
> reset **wiped all previous data**. Treat it as a demo/pre-launch instance.

---

## 1. Sign-in accounts

All accounts use the password **`DatumproDemo!2026`**.

| Role | Name | Email | What they can do |
|------|------|-------|------------------|
| **Owner / Admin** | Allen Karumbidza | `karumbidzaallen21@gmail.com` | Everything — full portfolio, all projects, finance, settings. *(Your own login — change the password after the demo.)* |
| **Project Manager** | Patience Ncube | `pm@datumpro.demo` | Runs all three projects: assigns work, approves sign-offs, manages the programme, reviews payments. |
| **Contractor (Civils)** | Brian — BuildRight Civils | `buildright@datumpro.demo` | Field view: their assigned tasks, submit work for sign-off, raise blockers/RFIs, request payment. |
| **Contractor (Electrical)** | Sipho — Spark Electrical | `sparkelec@datumpro.demo` | Same field view, electrical scope. |
| **Contractor (Plumbing)** | Tendai — AquaPlumb Services | `aquaplumb@datumpro.demo` | Same field view, plumbing scope. |
| **Client / Viewer** | Grace — Client Rep | `client@datumpro.demo` | Read-only client visibility of progress on their projects. |

> **Tip:** run the demo with two windows/devices — sign in as **Patience (PM)** on the
> web dashboard and as a **contractor** on the mobile app to show the two-sided flow
> (assign → do → submit → sign off).

---

## 2. The three projects

| Project | Stage | Progress | Story it tells |
|---------|-------|----------|----------------|
| **Riverside Mall Fit-Out** | ✅ Completed | **100%** | A finished, handed-over project. Every task done, snagging closed, payments settled, practical completion recorded. Shows what "done" looks like end-to-end. |
| **Hillside Apartments — Block A** | 🟠 Almost complete | **90%** | The star of the demo. Structure & services complete; finishing + snagging underway. Has **1 task submitted for sign-off** (approval demo), **1 blocked task** (blocker/delay demo), open snags, a variation awaiting approval, and live team chat. |
| **Central Clinic Extension** | 🔵 Early / active | **18%** | Early works & substructure. Mostly to-do with a few in-progress, upcoming calendar events, and a task that *should have started but hasn't* (schedule-adherence demo). |

Progress is **effort-weighted** (the `project_progress` metric) and identical on web and
mobile. Each project also has a **burn-up trend** (last 30 days of snapshots) on its Overview.

---

## 3. Suggested demo script (feature by feature)

**A. The portfolio dashboard (sign in as Patience — PM)**
1. Land on the dashboard — greeting engine ("Good afternoon, Patience…"), the delivery
   KPIs (awaiting approval / blockers / overdue), and the **project-level timeline** (one
   bar per project, not tasks).
2. Point out the three projects at 100% / 90% / 18%.

**B. A completed project (Riverside Mall Fit-Out)**
3. Open it → **100% complete**, all tasks done, practical completion recorded.
4. Show the **burn-up trend** climbing to 100%, the closed **snags** punch-list, and the
   **payments** all settled.

**C. The near-complete project (Hillside Apartments) — the main story**
5. Overview → **90%**, timeline with mostly-done bars.
6. **Tasks tab** → the **submitted** task ("Internal finishes & painting") waiting on the
   PM. Approve it → watch progress tick.
7. The **blocked** task ("Balcony balustrades") → open it to show the blocker note.
8. **Chat** → active team channel; reactions, a pinned message, unread badges.
9. **Registers**: Drawings (with revisions), RFIs, Snags, Site diary, Transmittals,
   Variations (one **awaiting approval**), Calendar (upcoming site meetings/inspections),
   Site reports.
10. **Payments** → a claim **awaiting review**; approve → mark paid.

**D. The early project (Central Clinic Extension)**
11. Overview → **18%**, early-stage timeline.
12. Show the **greeting/insight** flagging a task that *should have started but hasn't*
    (schedule adherence), and the **upcoming calendar events**.

**E. The mobile app (sign in as a contractor, e.g. Brian)**
13. Home → **effort-weighted progress** matching the web; "on track / behind" pill.
14. **Tasks** → single-column list; open a task → its **checklist (subtasks)** and the
    **in-task discussion** (chat lives in the task, with an unread badge).
15. **Team channel** → burger menu (portrait) / side rail (landscape) to reach the
    registers; open the **month-grid calendar** and tap a day; tap an **event** for details.
16. Submit a task for sign-off from the field, then flip to the PM window to approve it.

**F. Roles (sign in as Grace — client)**
17. Read-only client visibility: progress and high-level status, no edit controls.

---

## 4. What's in the data (seeded volumes)

| Area | Count |
|------|-------|
| Company / users / clients | 1 / 6 / 2 |
| Projects | 3 |
| Tasks / subtasks / dependencies | 28 / 134 / 25 |
| Progress snapshots (30-day burn-up) | 33 |
| Chat messages / reactions / pins | 43 / 8 / 3 |
| Drawings / revisions | 19 / 26 |
| RFIs / snags / transmittals | 11 / 15 / 8 |
| Variations / calendar events / to-dos | 5 / 7 / 12 |
| Site-diary entries / site reports / milestones | 17 / 14 / 13 |
| Payment claims / approval-inbox items | 11 / 22 |

Payment claims: **$440k paid**, **$156k approved**, **$100k awaiting review** (the awaiting
ones — Hillside "Plastering & screeds" and Central "Earthworks" — are the approve-during-demo items).

All six accounts were sign-in tested and work.

## 5. Re-running / resetting

- Accounts are (re)created by `scripts/seed/reset-users.mjs` (Auth Admin API).
- The data reset + core seed is SQL run against the project. Ask Claude Code to "reset the
  demo data" to regenerate.
