# DatumPro — Acceptance Test Plan (fresh-org pass)

> **State**: live DB wiped 2026-09-05, accounts kept. One org (Meridian Construction),
> zero projects — every flow starts from real empty states.
> **Builds under test**: web = production `datumpro.app` (main), mobile = APK build
> `cd2e8bef` (2026-09-05, includes both keyboard fixes + HSE diary).

## 1. Accounts (password `DatumproDemo!2026` unless noted)

| Account | Role | Use for |
|---|---|---|
| `karumbidzaallen21@gmail.com` | Owner | org setup, BOQ/tenders, finance approvals |
| `pm@datumpro.demo` (Patience) | PM | project management, sign-offs — **project-scoped** |
| `buildright@` / `sparkelec@` / `aquaplumb@datumpro.demo` | Contractors | field flow on mobile |
| `client@datumpro.demo` (Grace) | Client | read-only checks |
| `staff@datumpro.demo` (Simba) | Staff | project-scoped internal user |
| `brightkarumbidza154@gmail.com` | PM (real) | second PM for multi-PM checks |

## 2. How to record results

One running note (phone-friendly) per session; batch it back to Claude, who triages
into GitHub issues for the worker. **One numbered entry per finding**, exactly this shape:

```
#7 · S2 · web · owner · Payments
Steps: Projects → Riverside → Payments → Approve claim → confirm
Expected: claim moves to approved, contractor notified
Actual: 500 error toast, claim stuck pending
Evidence: screenshot IMG_2231, ~14:32
```

- **Severity**: S1 = blocker/data loss/security · S2 = feature broken, has workaround ·
  S3 = wrong but usable · S4 = cosmetic/copy.
- Always name the **account** + **platform** (web / mobile APK / mobile browser).
- Permissions findings: say what you could see/do that you shouldn't (or vice-versa).
- Screenshot everything odd, with the URL bar visible on web. Note the time — server
  logs are searchable by timestamp.
- Not sure if it's a bug? Log it as S4 with a `?`. Cheap to close, expensive to miss.

## 3. Known / by-design — do NOT file these

- Phone push is **dormant** until `NOTIFICATION_PUSH_SECRET` is set (in-app bell works).
- PMs and staff can't see the org BOQ library, tenders, or contractor documents — by design (#139/#143). PM sees the BOQ **linked to their own project**, read-only.
- Org BOQ nav item is owner/admin only now.
- Google/Teams calendar sync — deferred (no OAuth creds).
- Billing/subscriptions — designed, not built.
- Staff accounts are single-org and staff tasks carry no money — by design.

## 4. Test phases (in order — each builds the data the next one uses)

### P0 · Automated (done by Claude, 2026-09-05)
Sign-in smoke 7/7 ✓ · empty-state reads clean per role ✓ · RLS impersonation
checks per persona ✓ · CI RLS regression suite green on main ✓ · security advisors
run (warnings noted as hardening backlog, no errors) ✓.

### P1 · Org & members (owner, web)
Org settings + logo · **invite a brand-new email** (does the invite mail arrive? accept
flow work?) · members page: assignment chips, assign/remove to project, change member
type, deactivate/reactivate · sign-in as the deactivated user (must fail closed).

### P2 · Project lifecycle (owner → PM)
Create client → create project (dates, calendar, setup fields) → assign Patience as PM
→ **as Patience: only this project visible**; as Simba/staff: nothing until enrolled ·
assign Bright to a second project → each PM sees only theirs · one PM on two projects.

### P3 · Permissions matrix (all accounts, ~30 min)
For each persona, deliberately try what they must NOT do — direct URLs included
(paste a project URL into a non-member's browser):

| Try as → | Staff | PM (other project) | Contractor | Client |
|---|---|---|---|---|
| Open non-member project by URL | ✗ | ✗ | ✗ | ✗ |
| Org BOQ library `/boq` | ✗ | ✗ | portal only | ✗ |
| Org setup `/org` | ✗ | ✗ | ✗ | ✗ |
| Finance pages | ✗ | own project only | own statement | ✗ |
| Edit anything | own project | own project | assigned tasks | ✗ (read-only) |

### P4 · Tasks & field flow (PM web + contractor mobile — the core loop)
PM creates tasks with subtasks → assigns BuildRight → contractor **accepts & prices**
on mobile → starts (project goes active) → ticks subtasks, uploads site photos with
captions → submits for sign-off → PM approves → **progress % moves and matches web ↔
mobile** · also: decline path, blocked task + note, extension request → PM decision,
task chat thread + unread badges, task documents.

### P5 · BOQ & tender (owner, web)
Create BOQ (sections, items, item numbering) → Excel import → link to project →
generate tasks → **create tender → invite a real external email you control** (the
one-click magic-link fix: click the email button on a device that has never seen
DatumPro — you must land signed-in on the bid form, no password step) → submit bid →
second bidder → unseal (only when eligible) → award → export/reprice into project.

### P6 · Registers (PM + staff, both platforms)
Site diary **with HSE snapshot** (incidents/near-misses/toolbox talk/notes — web and
mobile) · snags with photos → assign → fix → verify · RFIs raise/answer/close ·
drawings + a revision · transmittals · variation order → approval flow → check money
effect · site reports with photos · calendar events + attendees.

### P7 · Chat & to-dos
Team channel + DMs · attachments, reactions, pins · to-dos from chat: urgency,
assignee-only completion tick, due reminders (in-app) · unread counts across web/mobile.

### P8 · Payments (owner + contractor)
Milestone claim → PM/owner review → approve → mark paid · progress floor rules ·
retention deduction + release · contractor advance → recovery · contractor sees only
their own statement · approval matrix thresholds (second approver above limit).

### P9 · Notifications
Every action above should ring the in-app bell of the right person (and only them) ·
realtime toast while on-page · unread badge counts · after the push secret is set:
repeat on phone (Expo push) + browser (web push).

### P10 · UI sweep (last, both platforms)
Empty states everywhere (fresh org shows them all) · dark mode · phone-width web ·
long names/amounts overflow · keyboard behaviour on every mobile form (the two fixes)
· back-button/deep-link behaviour · slow-network feel on mobile data.

## 5. Exit criteria

Ship-ready when: zero S1/S2 open · P3 matrix fully ✗-verified · P4 core loop clean on
both platforms · P5 external-bidder flow works from a cold device · notifications
verified end-to-end once push secret is set.
