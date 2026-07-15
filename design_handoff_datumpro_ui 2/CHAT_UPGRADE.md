# Handoff: Chat — presence people-rail, member detail & mobile

## Goal
Add a **right-hand People rail** to the chat and make each person **clickable to a detail view**. Today `ChatPanel` fills the whole screen; we want a two-pane layout — conversation on the left, a live roster on the right that groups **Active now** vs **Offline**, and opening a person swaps the rail to their profile (contact, role, on-project task stats, recent activity). This must **cascade to mobile** and apply to **every place chat appears** — the project group chat *and* per-task discussions.

## Why this is one change, not many
`components/chat/chat-panel.tsx` is a **single shared component**. The project chat page (`app/(app)/projects/[projectId]/chat/page.tsx`) renders it, and the per-task discussion renders the same component. So building the People rail **into `ChatPanel` (or a wrapper around it)** upgrades all chat channels at once. Do the work once; pass different roster data per context.

The component **already has presence plumbing** — reuse it, don't rebuild:
- It joins a Supabase channel `chat:${conversationId}` with `presence: { key: currentUserId }` and calls `channel.track({ user_id, name })`.
- On `presence sync` it reads `channel.presenceState()` and currently only computes `onlineOthers` (a count). **Extend this to keep the actual Set of online `{user_id, name}`** instead of just the number.
- It already writes `profiles.last_active_at` every 30s — use that for the "Active 40m ago" offline sublabels.

## About the design files
The prototype in this bundle (`DatumPro - Current UI.dc.html`) shows the target look — open it, go to a project → **Chat**. It is a **visual reference in HTML**, not production code. Recreate the layout inside the Next.js/Tailwind codebase using the existing `ChatPanel`, `@/components/ui/*`, `@/components/icons`, and Tailwind tokens (the prototype's hex values already map to the theme: `zinc-200` `#e4e4e7`, `blue-600`/`brand-600` `#2563eb`, etc.). The prototype's Chat screen carries `data-screen-label="Chat"`.

## Fidelity
High-fidelity layout & interaction; final colors/spacing. Keep the existing message-thread, composer, attachments, reactions, search, typing, read-receipts behaviour **exactly as-is** — this change is **additive** (a rail + a detail view + responsive shell). Do not regress any current ChatPanel feature.

---

## Layout — desktop (≥ lg)
A two-column shell wrapping the existing chat:

```
┌───────────────────────────── chat shell (h-full) ─────────────────────────────┐
│  ┌───────────── conversation (flex-1, min-w-0) ─────────────┐  ┌── rail 300px ─┐│
│  │  header (title · "N members · M online")                 │  │  People / or  ││
│  │  message list (flex-1, overflow-y-auto)                  │  │  member detail││
│  │  composer (border-top)                                   │  │  (border-left)││
│  └──────────────────────────────────────────────────────────┘  └──────────────┘│
└────────────────────────────────────────────────────────────────────────────────┘
```
- Shell: `flex h-full min-h-0`. Conversation column `flex flex-1 min-w-0 flex-col`. Rail `flex w-[300px] flex-shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 min-h-0`.
- The existing message list keeps `flex-1 overflow-y-auto`; the composer stays pinned at the bottom of the conversation column (`border-top` divider, as in the prototype).
- Header shows the conversation title plus a small pill: **"{memberCount} members · {onlineCount} online"** (`rounded-full bg-zinc-100 text-zinc-600 px-2 py-0.5 text-[11px] font-medium`).

## People rail — list mode (default)
- Rail header: `flex items-center justify-between border-b px-4 py-3.5` — `h3` "People" (`text-[13px] font-semibold`) + member count (`text-[11px] text-zinc-400`) on the right.
- Body `flex-1 overflow-y-auto p-2`, two grouped sections:
  - **`ACTIVE NOW · {onlineCount}`** — section label `px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400`.
  - **`OFFLINE · {offlineCount}`** — same label style, `pt-3.5`.
- Each person row: `flex items-center gap-2.5 rounded-lg p-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800`:
  - **Avatar** 32px circle. Prototype uses initials on a per-person color; if the app has profile photos use them, else initials on a deterministic color. A **presence dot** (10px, `border-2 border-white`) sits bottom-right: online `#22c55e`, offline `#d4d4d8`. Offline avatars render at `opacity-55`.
  - **Text** (`min-w-0`): name (`text-[13px] font-medium`, truncate) + sub (`text-[11px] text-zinc-400`, truncate). Online sub = the person's **role label**; offline sub = **"Active {n}m ago"** derived from `last_active_at`.
  - A right chevron (`stroke-zinc-300`, 15px).
- Sort online members first; within a group, PM/owner first is a nice touch but not required.

## People rail — member detail mode
Clicking a row replaces the rail contents with that person's profile (rail width unchanged; the conversation column does not move):
- **Detail header:** `flex items-center gap-2 border-b px-3 py-3` — a back button (left-chevron in a `h-[30px] w-[30px] rounded-lg hover:bg-zinc-100` hit area) that returns to list mode, then the label "People".
- **Identity block** (`flex flex-col items-center gap-2 border-b border-zinc-100 px-5 py-6`):
  - 72px avatar with a 16px presence dot (`border-[3px] border-white`).
  - Name `text-base font-semibold`; status line under it — online: "Active now" `text-green-600`; offline: "Active {…} ago"/"Offline" `text-zinc-400` (`text-xs`).
  - Role pill (`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize`) colored per role (table below).
  - **Quick actions** row: three round 36px buttons — **Message** (filled `bg-brand-600 text-white`, jumps focus to composer / opens a DM if you have DMs), **Call** and **Email** (outline `border border-zinc-200 hover:bg-zinc-50`). Icons from `@/components/icons`: message-circle, phone, mail.
- **Contact** section (`border-b border-zinc-100 px-5 py-4`): uppercase label "CONTACT"; rows for phone and email with a leading muted 15px icon, `text-[13px] text-zinc-700`, email truncates.
- **On this project** section: uppercase label; a `grid grid-cols-2 gap-2` of two stat tiles (`rounded-lg bg-zinc-50 px-3 py-2.5`): **Open tasks** and **Completed**, each a big `text-xl font-semibold tabular-nums` count over an `text-[11px] text-zinc-500` label. Pull counts from the member's tasks on this project.
- **Recent activity** section: uppercase label; a left-bordered timeline (`border-l border-zinc-200 pl-3.5`, list `gap-3`), each item a 7px dot on the rail plus `text-[13px] text-zinc-700` text and `text-[11px] text-zinc-400` timestamp. Source from the member's recent audit/activity events on the project (reuse whatever feeds the task Activity tab).

### Role → pill colors
| role | label | bg | text |
|---|---|---|---|
| owner | Owner | `#faf5ff` | `#7e22ce` |
| pm | Project manager | `#eff6ff` | `#1d4ed8` |
| contractor | Contractor | `#fff7ed` | `#c2410c` |
| contributor | Contributor | `#f4f4f5` | `#52525b` |
| client | Client | `#f0fdf4` | `#15803d` |
| viewer | Viewer | `#f4f4f5` | `#52525b` |

(These reuse the app's existing role/badge palette.)

---

## Mobile & responsive (cascade)
The rail must not crush the conversation on small screens.

- **≥ lg (desktop):** side-by-side as above, rail always visible.
- **< lg (tablet/mobile):** rail is **hidden by default**; the conversation goes full-width. Add a **People toggle** in the chat header (an avatar-stack or a people icon showing the online count). Tapping it opens the rail as:
  - a **right-side drawer / slide-over** on tablet, or
  - a **full-screen overlay sheet** on phones (slides in from the right, `position:fixed inset-0 z-40`, with its own back/close affordance).
- In the overlay, **list mode → detail mode** is the same in-place swap (back button returns to the list; a top-level close returns to the conversation).
- Message bubbles already cap at `max-w-[80%]`; keep that. Ensure the composer, attach/record controls, and safe-area padding all work at 360px width. Presence dots, 44px minimum tap targets on all rail rows and action buttons.
- Respect existing dark mode (`dark:` variants) throughout the rail and detail view — mirror the neutrals the prototype uses (`zinc-950` surfaces, `zinc-800` borders).

---

## Data wiring

### Presence (online set)
In the `presence sync` handler, instead of just `setOnlineOthers(ids.size)`, build and store the **Set/array of online `user_id`s** (names already come through `track`). Derive:
- `onlineMembers` = project members whose id ∈ online set.
- `offlineMembers` = the rest, each annotated with a relative "Active {…} ago" string from `profiles.last_active_at`.
Keep counting `currentUserId` in the roster (show "You"), even though `onlineOthers` excluded self.

### Roster source (per context)
Pass a `members` prop into `ChatPanel` (or a new `ChatWithRoster` wrapper):
- **Project chat:** `listProjectMembers(projectId)` (already fetched in the page) → `{ userId, name, role }`. Enrich with profile `phone`, `email`, `avatar`, `last_active_at`, and per-project task counts.
- **Task chat / per-task discussion:** pass the **task participants** (assignee + watchers/commenters + PM) as the roster; the header label becomes the task name. Same rail, same detail view. The per-member "On this project" stats can scope to the task (Open/Done subtasks or checklist) or stay project-level — pick one and be consistent.

### Member detail source
On row click, set a `selectedMemberId` state (client). Look the member up in the roster; lazy-load the heavier bits (recent activity, exact task counts) on open if they aren't already present. Provide a `clearSelection()` for the back button. No new realtime channels needed.

## State
New client state on the chat (all local, no server round-trips except optional lazy detail fetch):
- `onlineIds: Set<string>` (replaces the bare `onlineOthers` count; keep a derived count for the header).
- `railOpen: boolean` (mobile drawer/sheet visibility; always true visually on lg).
- `selectedMemberId: string | null` (null = list mode, id = detail mode).

## Design tokens (chat rail)
- Surfaces white / `#fafafa`; dark `zinc-950`. Borders `#e4e4e7` (`zinc-200`), light divider `#f4f4f5` (`zinc-100`); dark `zinc-800`.
- Presence: online `#22c55e`, offline `#d4d4d8`.
- Accent: `brand-600` `#2563eb`, hover `#1d4ed8`. Own-message bubble stays the app's current `brand-50` tint (don't switch to solid unless product asks).
- Text: name `zinc-900`/`white`, sub `zinc-400`, body `zinc-700`.
- Radius: rail rows/tiles/buttons `rounded-lg` (8px); pills `rounded-full`; avatars circle. Rail width `300px`.
- Type: rail name `13px/500`, sub `11px`, section labels `10px uppercase tracking-[0.05em]`, detail name `16px/600`, stat numbers `20px/600 tabular-nums`.
- Icons: `@/components/icons` (message-circle, phone, mail, chevron-left, chevron-right). Presence dot is a bordered span, not an icon.

## Files to touch
- `components/chat/chat-panel.tsx` — wrap output in the two-pane shell; extend presence-sync to store online ids; add the People rail (list + detail) and the mobile drawer/toggle. Accept a `members`/roster prop (+ optional `contextLabel`).
- `app/(app)/projects/[projectId]/chat/page.tsx` — pass `listProjectMembers(...)` (already fetched) enriched with profile + task-count data into `ChatPanel`.
- The **per-task discussion** render site (wherever `ChatPanel` is mounted for a task) — pass the task's participant roster so the same rail appears there.
- `lib/data/members.ts` / `lib/data/chat.ts` (or a small new query) — add the per-member enrichment: `phone`, `email`, `last_active_at`, open/done task counts, recent activity. Reuse the Activity-tab source for recent events.
- Confirm `profiles` exposes `phone`, `avatar`, `last_active_at` (it already tracks `last_active_at`); add columns only if missing.

## Assets
No image assets. Icons are lucide via `@/components/icons`. Avatars use existing profile photos when present, else initials on a deterministic per-user color.
