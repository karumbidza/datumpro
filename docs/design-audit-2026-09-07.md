# DatumPro web app — UI/UX uniformity audit (2026-09-07)

Signed-in crawl of 17 routes as a PM (Playwright, desktop 1440 + mobile 375),
axe on every desktop route, full-page screenshots reviewed by eye. Judged
against what an enterprise-grade front end holds itself to: one type scale, one
control vocabulary, one header pattern, contrast floor everywhere, no dead ends.

## Scorecard

| Route | axe (desktop) | Notes |
|---|---|---|
| /dashboard | contrast ×33 · heading-order · scrollable-region-focusable | KPI + timeline labels |
| /projects/:id (overview) | contrast ×44 · heading-order · scrollable-region-focusable | worst page; activity + sparkline labels |
| tasks | contrast ×11 | |
| programme | contrast ×13 · **aria-prohibited-attr ×4** | aria-label on plain divs |
| finance | contrast ×3 · heading-order | |
| team | **select-name ×7** · heading-order · landmark-unique | unlabeled dropdowns |
| settings | contrast ×4 · landmark-unique | |
| /payments (org) | contrast ×1 · heading-order | |
| /settings (org) | page-has-heading-one | |
| notifications | contrast ×1 | |
| boq · diary · snags · rfis · drawings · calendar | **0 violations** | |
| chat (v2) | **0 violations** | fixed this session |

**Mobile: no horizontal overflow on any route.** No 404s from real nav links
(the one 404 in the crawl was a guessed URL — project payments correctly live
at `/finance`).

## Priority 1 — accessibility floor (mechanical, ~1 day)

1. **`text-zinc-400` as body/label text on white** — the single biggest source
   (100+ nodes across dashboard, overview, tasks, programme, finance,
   settings). 4.44:1 at best, usually worse at 10–11px. The chat/landing fix
   established the rule: **zinc-400 is for icons and disabled states only;
   text starts at zinc-500** (`dark:` mirrored). A codemod-style sweep of
   `text-zinc-400 dark:text-zinc-500` → `text-zinc-500 dark:text-zinc-400` on
   text nodes closes most of the table above.
2. **Team page selects have no accessible name** (×7) — add `aria-label` or a
   visually-hidden `<label>` to the role/member dropdowns.
3. **Programme `aria-prohibited-attr`** — `aria-label` sits on non-interactive
   `<div>`s (Gantt bars); move to `role="img"` + label or use `title`/sr-only.
4. **Heading order** — most pages jump h1→h3 (or have no h1: org settings,
   org payments). Adopt: one h1 per page (the page title), h2 for sections,
   never skip. The chat page's sr-only h1 pattern works where the visual
   design doesn't want a big title.
5. **Scrollable regions not focusable** (dashboard/overview timeline) — add
   `tabIndex={0}` + an aria-label to the Gantt scroll container so keyboard
   users can scroll it.
6. **Duplicate landmarks** (settings, team) — multiple unlabeled `aside`/`nav`;
   give each an `aria-label` (chat's rail now does this).

## Priority 2 — uniformity (the designer's eye, ~2–3 days)

7. **Two header grammars.** Dashboard/overview: h1 + subtitle, actions
   top-right ("New task" blue, "New site report" outline — correct). Registers
   (Snagging, RFIs…): h1 + subtitle, then the primary action **left-aligned
   below the title** with filters right on the same row. Pick the
   register grammar or the overview grammar and apply it everywhere —
   recommendation: title left, primary action right, filters below a hairline.
8. **Three filter-control vocabularies** on one product: black-pill-vs-outline
   chips (Timeline "All/Overdue/…"), text-only segmented filters (Snagging
   "Open/Closed/All"), and select dropdowns elsewhere. Standardise on one
   chip/segmented component (the Timeline pill set is the strongest) and reuse.
9. **Micro-label inconsistency** — "PROGRESS TREND", "RECENT ACTIVITY",
   "PROJECT", "ACTIVE NOW" all use 10px uppercase but differ in tracking,
   weight and colour; several were below the contrast floor (chat/sidebar/toast
   instances fixed this session). Define one `.micro-label` recipe
   (10–11px / medium / tracking 0.05em / zinc-500) and use it everywhere.
10. **Empty states are three different species**: dashed-border box with icon
    (Snagging — good), bare grey sentence (v1 chat — replaced), plain Card
    (project chat missing). Adopt the chat-v2 pattern: one sentence of
    orientation + 1–3 real actions, no illustration.
11. **Timeline legend repeats two identical blues** ("Active" and "In review"
    dots render near-identically) — needs a distinguishable hue or pattern;
    also the legend swatches are the only place status colours appear without
    text labels attached to data.
12. **Greeting/dashboard density** — the dashboard is one KPI strip + one
    timeline with a single project; at enterprise scale this holds, but the
    KPI numbers use three different font sizes across dashboard/overview/chat
    KPIs. One `tabular-nums` KPI recipe.

## Priority 3 — polish (opportunistic)

13. Sidebar footer truncates the org email under the theme/notification icons
    (visible at 1440) — reflow or truncate with title attribute.
14. Sparkline axis labels (overview "09-05/09-06") are raw ISO fragments —
    format like every other date on the surface ("5 Sep").
15. "Project set up" nav label vs "Settings" elsewhere — one name.
16. The register pages' subtitle prose ("— the defects register: raise,
    assign, track…") is good voice; dashboard/overview subtitles are drier.
    Align tone (the register voice is the better one).

## What's already uniform (keep)

Zinc + single blue palette, 8px radius family, hairline borders, the sidebar,
the register pages as a family (boq/diary/snags/rfis/drawings/calendar all
axe-clean and visually consistent), tabular numerals in most data, and the
chat-v2 / landing conventions established this week (focus rings, zinc-500
text floor, labelled landmarks).

## Suggested execution order

One PR per priority: P1 is mechanical and testable (re-run this crawl, expect
0 axe violations everywhere); P2 is a components pass (`micro-label`, filter
chips, page header, empty state — four shared recipes, then adopt per page);
P3 rides along with routine work. The crawl script lives in the session
scratchpad and is trivially recreatable: sign in, visit the 17 routes,
screenshot + axe.
