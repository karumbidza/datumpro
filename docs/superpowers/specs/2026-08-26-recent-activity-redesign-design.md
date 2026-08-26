# Recent Activity — light preview + drill-down

**Date:** 2026-08-26
**Status:** Approved (design), implementing on `feat/recent-activity-preview`

## Problem

On the project overview, `TimelineOverview` (Gantt) and `RecentActivity` render as two
near-identical full-width bordered cards stacked on each other — they read as "two overlapping
tables." Activity is meant to be a *complementary* glance ("what just happened": task closed,
assigned, blocked), with depth available on demand — not a second heavy panel competing with the
timeline.

## Solution

Make activity a visually **lighter companion** to the timeline, with a drill-down for the full log.

1. **Slim inline preview** (replaces the `RecentActivity` bordered card). A light, timeline-style
   feed under the Gantt: a type-toned dot + connecting line per event, the task title, a short
   message, and a relative time. No heavy card chrome — a small "Recent activity" label and the
   feed. Shows the **latest 5** events, ending in `View all activity →`.

2. **Drill-down = overlay modal that is also a real page.** `View all activity` opens the full feed
   in an overlay modal (dismiss → back to overview). A real `/projects/[projectId]/activity` page
   renders the same feed for shared/refreshed links and mobile. Modal open/close is client state
   (not URL-driven) — same UX, far fewer moving parts than Next.js intercepting routes, which stay
   an easy later upgrade.

3. **Full feed** (shared by the modal and the page): grouped by day (Today / Yesterday / date),
   filterable by **type** (All · Created · Assigned · Status · Blocked · Done) and by **person**,
   each row clicking through to its task.

## Components

- `activity-panel.tsx` (client) — holds the slim preview + modal open-state; renders the preview
  inline and `activity-feed.tsx` inside a `fixed inset-0` modal on "View all". Also links to the
  full page from the modal header.
- `activity-feed.tsx` (client, shared) — the grouped, filterable full list. Props: `items`,
  `members`, `projectId`. Used by the modal and the page.
- `activity-preview.tsx` — the slim 5-row dots-and-lines list (presentational).
- `projects/[projectId]/activity/page.tsx` (server) — fetches data + renders the feed framed as a
  page with a back link.
- **Removed:** `recent-activity.tsx` (bordered card).

## Data layer (`lib/data/tasks.ts`)

- Add `userId: string | null` to `ProjectActivityRow` (person filter needs a stable id).
- `listProjectActivity(projectId, 5)` — preview (existing fn, called with limit 5).
- `listProjectActivityFull(projectId, limit = 100)` — the window for the full view; filtering and
  day-grouping happen in `activity-feed.tsx` off this window, with "Load more" if it's exceeded.
- Person-filter options come from `listProjectMembers(projectId)` (existing).

## Scope guardrails (YAGNI)

- Feed is **event-based**; "overdue" is a task *state* the Timeline already surfaces (red bars) — we
  do not fabricate an overdue *event*. The two complement each other by design.
- No new nav item, no notification read-state, no new realtime — the existing `LiveRefresh`
  subscription already covers `task_activity`.
- Approaches B (nav tab) and C (hybrid) are trivial to grow into later since the full feed is the
  same component.

## Testing

- `pnpm typecheck` clean.
- Manual: overview shows the slim preview (5 rows, lighter than the Gantt); "View all" opens the
  modal; filters by type + person work; rows link to their task; `/projects/[id]/activity` renders
  the full page on direct load; empty state renders.
