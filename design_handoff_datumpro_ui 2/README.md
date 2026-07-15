# Handoff: DatumPro UI refresh — Dashboard, Project Overview & Tasks

## Overview
This package documents a set of UI changes to the **DatumPro** construction-project management web app (repo `karumbidza/datumpro`, `apps/web`, Next.js + Tailwind). The work keeps the app's existing visual DNA — minimal neutral zinc surfaces, a single blue accent (`#2563eb`), system font stack, 8px-radius cards — but **reduces clutter and empty whitespace** on three screens the user felt were "too empty," and reworks the Tasks view into a clean, aligned table.

Three screens changed:
1. **Dashboard** (`/dashboard`) — reordered and trimmed.
2. **Project Overview** (`/projects/[projectId]`) — stripped to the essentials.
3. **Project Tasks** (`/projects/[projectId]/tasks`) — Kanban board replaced with an aligned progress-bar table.

A shared **Timeline Overview** Gantt component appears on both Dashboard and Project Overview and is unchanged in behavior.

## About the Design Files
The files in this bundle are **design references created in HTML** (`.dc.html` prototypes). They show the intended **look, layout, and interaction** — they are **not** production code to paste in. The task is to **recreate these changes inside the existing `apps/web` Next.js codebase** using its established patterns: the `@/components/ui/*` primitives (`Card`, `Badge`, `Button`, `Progress`), Tailwind utility classes, and the existing server/client component structure. Match the existing files' conventions rather than importing anything from the prototype.

Because these are edits to an existing app, each section below is written as **"before → after"** so you can find the current component and change only what's described.

## Fidelity
**High-fidelity.** Colors, spacing, typography, and interactions are final. Recreate pixel-for-pixel using the codebase's existing Tailwind tokens (they already map to these exact values — e.g. `zinc-200` = `#e4e4e7`, `blue-600` = `#2563eb`).

---

## Screen 1 — Dashboard (`app/(app)/dashboard/page.tsx`)

### Purpose
Portfolio-level home for directors / PMs: the day's greeting, headline portfolio numbers, a cross-project timeline, items needing the viewer's approval, and upcoming tasks.

### What changed (before → after)

**New vertical order (top → bottom):**
1. Greeting header (unchanged)
2. KPI stat tiles (the 5-up "Total projects / In progress / On hold / Complete / Overall progress" strip) — **moved up to sit directly under the greeting**
3. **Timeline Overview** (the Gantt card) — moved up to sit right under the tiles
4. **Awaiting your approval** card — now an **expandable** list (see below)
5. **Upcoming tasks** — now **full-width**, at the bottom

**Removed entirely:**
- The **"Needs your attention"** chip row (the row of red/orange/blue pill badges: "1 task past due", "1 active blocker", etc.). It duplicated the approvals card and the KPI tiles — delete it.
- **"Projects by status"** bar chart card — deleted (duplicated the KPI tiles' counts).
- **"Reported progress over time"** area-chart card — deleted.
- **"Recent projects"** list card — deleted (already reachable via All Projects).

**Net effect:** the two-column charts grid is gone; "Upcoming tasks" is promoted from a half-width card to a single full-width card.

### Layout
- Page container: `mx-auto max-w-[1152px] flex flex-col gap-8 px-10 py-8`.
- KPI tiles: one bordered `Card` (radius 8, `border-zinc-200`, white) containing a `grid grid-cols-5`; each cell `px-5 py-4` with a right divider `border-r border-zinc-100` (last cell no divider). Label `text-xs text-zinc-500`; value `text-2xl font-semibold tracking-tight tabular-nums` on `mt-1`.
- Timeline Overview: full-width card (see "Shared component" section).
- Awaiting-your-approval: full-width card, `p-5`.
- Upcoming tasks: full-width card, `p-5`.

### "Awaiting your approval" card — expandable behavior (NEW)
Header row: `h3` "Awaiting your approval" (`text-sm font-semibold`) + a count pill on the right (`rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-semibold tabular-nums`, value `3`).

Below it a `ul` of approval rows. **Each row is a collapsible accordion item:**
- Collapsed row (clickable, `cursor-pointer`, `py-2.5`, `border-b border-zinc-100`): a colored status dot (8px), a kind chip, the title (`text-sm font-medium`, truncated), a muted subline (`text-xs text-zinc-500`, truncated), and a chevron on the right that **rotates 90° when expanded** (`transition-transform`).
- Expanded panel (only one open at a time — opening one closes the others; default: first row open): indented `pl-5`, contains a detail paragraph (`text-[13px] leading-normal text-zinc-700`) and an action row with two buttons + an "Open full detail →" link that navigates to the underlying task/project.

Kind chips (all `rounded-full px-1.5 py-0.5 text-[10px] font-semibold`):
| Kind | dot | chip bg | chip text |
|---|---|---|---|
| Sign-off | `#60a5fa` | `#eff6ff` | `#1d4ed8` |
| Extension | `#fbbf24` | `#fffbeb` | `#b45309` |
| Variation | `#c084fc` | `#faf5ff` | `#7e22ce` |

The three sample rows (use real data in the app):
1. **Sign-off** · "Slab pour Block A" · sub "Kariba Heights Apartments · submitted by Tariro Chirwa" · detail about the completion submission with photos · actions **Approve (mark done)** / **Reject** · opens the task.
2. **Extension** · "Electrical first fix" · sub "Kariba Heights Apartments · +4 days requested" · detail about the reason + new due date + paused SLA · actions **Grant extension** / **Decline** · opens the task.
3. **Variation** · "VO-012 · Additional retaining wall" · sub "Msasa Warehouse Fit-out · +$4,800.00 · +6d" · detail about the geotech-driven variation · actions **Approve variation** / **Reject** · opens the project.

Primary action button: `bg-blue-600 text-white hover:bg-blue-700 rounded-md px-4 py-2 text-sm font-medium`. Secondary: `border border-zinc-200 text-zinc-900 hover:bg-zinc-50` same metrics. "Open full detail →" link: `ml-auto text-[13px] font-medium text-blue-700 hover:underline`.

### Upcoming tasks (full-width)
`h3` "Upcoming tasks" then a `ul`; each `li` is a `flex items-center gap-3 py-2.5` row with `border-b border-zinc-100` (last none): title (`text-sm font-medium`, truncated) + project · assignee subline (`text-xs text-zinc-500`), a priority pill, and a right-aligned due date (`w-24 text-right text-xs text-zinc-400 tabular-nums`). Priority pills: high/urgent = `bg-amber-50 text-amber-700`; medium/low = `bg-zinc-100 text-zinc-600`; all `rounded-full px-2 py-0.5 text-xs font-medium`.

---

## Screen 2 — Project Overview (`app/(app)/projects/[projectId]/page.tsx`)

### Purpose
Single-project home. The user asked to keep it **clean** — "the tile cards then the timeline overview only."

### What changed (before → after)
**Keep only two blocks:**
1. The **4-up alert tile cards** (Pending Sign-offs / Active Blockers / SLA Breaches / Open Requests)
2. The **Timeline Overview** Gantt card

**Removed** everything else that was on the page:
- "Schedule & earned progress" card (earned/planned bars + SPI/critical-path/finish dates `dl`)
- "Latest reported progress" card
- "Variations" panel (approve/reject list + "Raise a variation")
- "Milestones" list + add-milestone form
- "Recent site reports" list

(These features still exist elsewhere in the app / can move to sub-tabs — this screen just shouldn't render them inline. Confirm with product before deleting the underlying components; here they are simply removed from this page's composition.)

### Layout
- Page container: `mx-auto max-w-[1152px] flex flex-col gap-8 px-10 py-8`.
- Header: project name `text-2xl font-semibold tracking-tight` + client subline `text-sm text-zinc-500`; right side two buttons — "New site report" (secondary) and "New task" (primary blue).
- Alert tiles: `grid grid-cols-4 gap-3`. Each tile is a **tinted** card `rounded-lg border p-4` with an icon chip, a big count, a label, and a small subline. Exact tints:

| Tile | border | bg | icon stroke | icon-chip bg | count text | label text | subline text |
|---|---|---|---|---|---|---|---|
| Pending Sign-offs | `#bfdbfe` | `#eff6ff` | `#2563eb` | `#dbeafe` | `#1d4ed8` | `#2563eb` | `rgba(59,130,246,.7)` |
| Active Blockers | `#fed7aa` | `#fff7ed` | `#ea580c` | `#ffedd5` | `#c2410c` | `#ea580c` | `rgba(249,115,22,.7)` |
| SLA Breaches | `#fecaca` | `#fef2f2` | `#dc2626` | `#fee2e2` | `#b91c1c` | `#dc2626` | `rgba(239,68,68,.7)` |
| Open Requests | `#fde68a` | `#fffbeb` | `#d97706` | `#fef3c7` | `#b45309` | `#d97706` | `rgba(245,158,11,.7)` |

Icon chip: `inline-flex rounded-lg p-2`; icon 20px (lucide: `Clock`, `ShieldAlert`, `AlertTriangle`, `CalendarClock`). Count `text-2xl font-bold`; label `text-xs`; subline `text-[11px] mt-0.5`.
- Timeline Overview directly below, `gap-8` between.

---

## Screen 3 — Project Tasks (`app/(app)/projects/[projectId]/tasks/page.tsx`)

### Purpose
List every task in a project. The user asked for the Kanban board to become **tile/row cards like the projects-list progress cards**, then refined it to **"all bars and details aligned — one bar length, like an invisible table, nothing overlapping."**

### What changed (before → after)
- **Removed** the 5-column Kanban board (To do / In progress / Awaiting sign-off / Blocked / Done columns of stacked cards).
- **Added** a single vertical list of **full-width row cards**, one per task, laid out as an **aligned CSS-grid table** with a header row.

### Layout — the table
Both the header row and every task row use the **same grid template** so columns line up perfectly:

```
grid-template-columns: 170px minmax(150px, 1fr) 44px 64px 104px 16px;
align-items: center;
gap: 14px;
```
Columns, in order: **Task/assignee · Progress · % · Priority · Status · chevron**.

**Header row** (not a card): `px-4 pb-2`, `text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400`. Labels: "Task / assignee", "Progress", "%" (right-aligned), "Priority" (center), "Status" (center), empty last cell.

**Task rows:** vertical stack `flex flex-col gap-2`. Each row is a clickable card: `rounded-lg border border-zinc-200 bg-white px-4 py-3 cursor-pointer hover:border-zinc-300`, using the shared grid template above.

Cells:
1. **Task/assignee** (`min-w-0`): title `text-sm font-semibold text-zinc-900` truncated; assignee `text-xs text-zinc-500` truncated.
2. **Progress** (`min-w-0`): a **full-width rail always at 100% length** — `relative h-2 rounded-full bg-zinc-100` — with an absolutely-positioned fill `h-2 rounded-full` whose `width` = the task's percent and whose color = the status bar color (below). Under the rail, a `mt-1 flex items-center justify-between gap-2 text-[10px]` line: left = a status meta note (truncated, colored per status), right = "Due {date}" (`flex-shrink-0`, `text-zinc-400`).
3. **%** : `text-right text-sm font-semibold text-zinc-900 tabular-nums`, e.g. "55%".
4. **Priority**: centered pill.
5. **Status**: centered pill.
6. **Chevron**: 16px right chevron, `stroke-zinc-300`.

Keeping the badge cells at fixed track widths (64/104px) and center-justifying the pill inside is what fixes the earlier overlap — the pills no longer push the chevron around.

### Status → colors + labels
| Status key | pill label | pill bg | pill text | bar fill |
|---|---|---|---|---|
| `done` | Done | `#f0fdf4` | `#15803d` | `#16a34a` |
| `in_progress` | In progress | `#eff6ff` | `#1d4ed8` | `#2563eb` |
| `submitted` | Review | `#eff6ff` | `#1d4ed8` | `#3b82f6` |
| `blocked` | Blocked | `#fffbeb` | `#b45309` | `#d97706` |
| `todo` | To do | `#f4f4f5` | `#52525b` | `#d4d4d8` |

Priority pills: high/urgent = bg `#fffbeb` text `#b45309`; medium/low = bg `#f4f4f5` text `#52525b`. All pills `rounded-full px-2 py-0.5 text-xs font-medium`.

Status meta note colors (the small line under the bar): critical-path note `#dc2626` (prefix "● "); signed-off `#16a34a` (prefix "✓ "); blocker note `#d97706` (prefix "🚧 "); slack/awaiting-review neutral `#a1a1aa`.

### Header of the page
Back link "← {project name}" (`text-xs text-zinc-500 hover:underline`), `h1` "Tasks" (`text-2xl font-semibold tracking-tight`), "New task" primary button on the right.

---

## Shared component — Timeline Overview (Gantt)
Used on Dashboard (all-project tasks) and Project Overview (single-project tasks). **Behavior unchanged** from the current app — documented here only so you can confirm placement.

- Card: `rounded-lg border border-zinc-200 bg-white`. Header bar `flex items-center gap-2 border-b px-4 py-3` with a list icon + `h3` "Timeline Overview".
- Toolbar: a search input (`Search tasks…`), filter pills (All / Overdue / Blocked / Active / Done), and a Scale toggle (day / week / month) pushed right. Active pill = `bg-zinc-900 text-white`; inactive = `border border-zinc-200 text-zinc-500`.
- Summary line `text-[11px] text-zinc-400`: "Showing N of M tasks · X overdue · Y blocked".
- Grid: sticky left column (170px, "TASK / ASSIGNEE") + a scrollable day grid (36px per day). Sticky header row (44px). A blue "today" line (`#2563eb` at 30% opacity) spans the body.
- Each task row (54px): left cell shows title + status badge + assignee + project; right cell shows a grey "scheduled/ghost" bar plus a colored actual bar, an optional red overdue "spill", and a small label ("✓ done", "Nd over", "blocked", "in review", "Nd left", "due today").
- Bar legend footer: Scheduled `#d4d4d8`, Active `#2563eb`, Done `#16a34a`, Overdue `#dc2626`, Blocked `#d97706`, In review `#3b82f6`.

If your codebase already has this component, leave it as-is and just place it per screens 1 & 2.

---

## Interactions & Behavior
- **Approvals accordion (Dashboard):** click a row toggles it; only one open at a time; first row open by default; chevron rotates 0°→90°; `transition-transform ~150ms`. Action buttons and "Open full detail →" perform the approve/reject/navigation the real endpoints require.
- **Task row / project row / approval row:** whole card is clickable → navigate to the detail route.
- **Hover:** cards lift their border from `zinc-200` to `zinc-300`; buttons darken (`blue-600`→`blue-700`) or gain `bg-zinc-50`.
- **Timeline:** search filters rows; filter + scale pills switch active state; horizontal scroll on the day grid with sticky task column and header.
- No new loading/error states introduced — reuse the app's existing patterns.

## State Management
- **Dashboard:** `expandedApproval` (index of the open approval row, or none) — client state on the approvals card. Everything else is data already fetched for the current dashboard.
- **Tasks:** none new — it's a render change over the existing task list. (If the old board tracked column drag state, that can be removed.)
- **Project Overview:** none new — it's a composition change (render fewer blocks).

## Design Tokens
Colors (all already in the Tailwind theme):
- Neutrals: text `#18181b` (zinc-900), `#3f3f46` (zinc-700), `#52525b` (zinc-600), `#71717a` (zinc-500), `#a1a1aa` (zinc-400); borders `#e4e4e7` (zinc-200), `#f4f4f5` (zinc-100); surfaces white / `#fafafa` (zinc-50).
- Accent: `#2563eb` (blue-600), hover `#1d4ed8` (blue-700), tint `#eff6ff` (blue-50), `#dbeafe` (blue-100).
- Semantic: green `#16a34a`/`#15803d`/`#f0fdf4`; amber `#d97706`/`#b45309`/`#fffbeb`/`#fef3c7`; orange `#ea580c`/`#c2410c`/`#fff7ed`; red `#dc2626`/`#b91c1c`/`#fef2f2`; purple `#7e22ce`/`#faf5ff`.
- Radius: cards `8px` (`rounded-lg`), buttons/inputs `6px` (`rounded-md`), pills `9999px`.
- Spacing rhythm: page padding `py-8 px-10` (or `p-6`/`p-10`), section `gap-8`, card padding `p-5` (20px), tight tiles `p-4` (16px).
- Type: system UI stack; sizes 24/18/16/14/12/11/10 px; weights 400/500/600/700; numeric fields `tabular-nums`; headings `tracking-tight`.

## Assets
No image assets. All icons are **lucide-react** (already used in the app): `Clock`, `ShieldAlert`, `AlertTriangle`, `CalendarClock`, `ChevronRight`, `ChevronDown`, list/kanban icons, etc. No new fonts.

## Files
Prototype reference files in this bundle (design intent — do not ship):
- `DatumPro - Current UI.dc.html` — all three screens plus sidebar, sign-in, finance, requests, team, task detail. Navigate via the sidebar / project switcher to reach each screen. The relevant screens carry `data-screen-label="Dashboard" | "Project overview" | "Tasks"`.
- `TimelineOverview.dc.html` — the shared Gantt component prototype.

Target files to edit in `apps/web`:
- `app/(app)/dashboard/page.tsx` and its `components/dashboard/*` (kpi row, approvals inbox, upcoming tasks; remove insight-banner / portfolio-charts / recent-projects usage).
- `app/(app)/projects/[projectId]/page.tsx` (keep alert tiles + timeline; drop schedule/variations/milestones/site-reports blocks from the composition).
- `app/(app)/projects/[projectId]/tasks/page.tsx` (replace board with the aligned table).
