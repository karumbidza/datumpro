# DatumPro — Backlog / Deferred work

Everything recommended but not yet built, from the build sessions. Grouped by
area and rough priority. **P0** = do before real crews rely on it; **P1** =
soon; **P2** = scale / polish.

---

## Task engine (the backbone)

- **[P0] Inline form-error UX.** Mutations currently `throw` on validation
  failures (bad subtask date on a client without min/max, submit-gate races),
  which hits Next's error boundary. Return `{ ok, error }` and show it inline —
  reuse the pattern already in the payments modal.
- **[P1] Validate assignee ∈ project members** at create/assign. The pending
  trigger only fires for contractor/contributor *project* roles; assigning an
  org member who isn't on the project gives no acceptance flow and they may not
  even see the task (RLS).
- **[P1] Subtask audit logging.** Ticks stamp `done_at` but aren't in the
  activity feed. Log subtask add / complete / reopen to `task_activity`
  (dispute-grade accountability in construction).
- **[P1] Un-accept / hand-back.** Once accepted there's no way to return a task;
  once declined the contractor loses access. Add a "return task" action.
- **[P2] Effort-weighted %.** Completion is equal-weight (done ÷ total). Real
  projects want weighting by effort / value / duration — add a `weight` column
  and switch the rollup when ready.
- **[P2] Per-subtask photo evidence.** `task_media` + `requires_photo_on_complete`
  exist at the task level; add optional photo attached to a *step*, and make the
  final step's photo required.
- ~~**[P2] Project %-over-time (burn-up).**~~ ✅ Done. Nightly `/api/cron/progress`
  snapshots each in-flight project's % into `project_progress_snapshots`; the
  overview shows a 30-day trend sparkline (`ProgressTrend`) with net change.
- **[P2] Mobile subtask date pickers.** Mobile "add step" is title-only; adding
  dates needs `@react-native-community/datetimepicker` (native dep → rebuild).
  The DB timeline constraint already enforces bounds for any dates set.
- **[P2] Project chat close-on-close.** Chat should go read-only when the project
  is closed (needs a project "closed" status + a trigger to flip the
  conversation status). `conversation_is_active` already gates posting.

## Notifications

- **[P1] Web push (desktop).** Notifications currently deliver in-app (bell) +
  email + **mobile Expo push**. Web relies on the in-app bell; desktop push
  needs the `web-push` lib + VAPID keys (the chat edge function already does web
  push — could share the path).
- **[P1] Reminder cadence / dedupe.** `/api/cron/reminders` re-nudges daily until
  a step is done / a task is accepted. Add per-item throttling if it's noisy.

## Performance & infra

- **[P0] Confirm prod env vars** or these silently no-op: `CRON_SECRET`
  (all crons refuse without it), `SUPABASE_SERVICE_ROLE_KEY` (push fan-out +
  cron notification writes), Resend key (email).
- **[P1] Middleware auth cost.** `middleware.ts` runs `auth.getUser()` (a network
  call to the auth server) on every matched request from the edge. Consider
  `getSession()` for gating (trade-off: no server-side JWT re-validation).
- **[P2] Dedupe RLS policies.** Advisor flagged 85 "multiple permissive policies"
  (e.g. a `_select` + a `FOR ALL` write policy both apply to SELECT). Combining
  them cuts per-query overhead at scale.
- **[P2] Supabase compute.** Currently **MICRO** (fine now — CPU ~2%). Bump when
  concurrent users grow.
- **[P2] Mobile round-trips.** The Cape Town → Frankfurt ~150–200ms/trip floor is
  geography (no African Supabase region). Further wins: stale-while-revalidate
  caching for instant screens, and collapsing multi-query screens into single
  RPCs.

### Done this session (for reference)
- Web functions pinned to `fra1` (co-located with the DB) — the big web win.
- Parallelized hot paths (mobile task screen, web task detail).
- Email/push moved off the click path via `after()`.
- `getUser()` → `getSession()` (local session) across mobile read paths.
- All 98 foreign keys indexed.

## Verification / testing

- **On-device keyboard check.** The composer keyboard fix was a best-effort
  edge-to-edge change; if it still overlaps, add `react-native-keyboard-controller`.
- **Two-device presence test.** Confirm online/offline dots update live.

## Quality / tooling

- ~~**ESLint not configured**~~ ✅ Done. Flat-config ESLint 9 (typescript-eslint +
  react-hooks + `@next/next`) across web, mobile, and shared; `next lint` retired
  for `eslint .`. `pnpm lint` runs clean via turbo. First pass caught two real
  bugs (a no-op `&&` statement, a broken unmount guard) and ~18 dead imports/vars.
