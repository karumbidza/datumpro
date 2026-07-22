# Handoff: Bid / Task-Plan Panel Redesign

## Overview
This is a visual redesign of the sealed-bid / task-plan creation panel that a
tender invitee uses to build and price their plan. It replaces the current
single wrapping flex-row of mismatched inputs with a **labeled add-step form** (a
bordered sub-card) plus **stacked step cards** below it. All fields share one
height and radius, the number spinners are removed, and the layout reads as a
clean, professional form.

**Target file to modify:** `apps/web/components/task/bid-panel.tsx`
Nothing else needs to change — the props, server actions, and data types stay
exactly the same. This is a markup/styling swap inside the existing component.

## About the Design Files
The file in this bundle — `BidPanel-redesign.dc.html` — is a **design reference
created in HTML**. It is a prototype showing the intended look and behavior, not
production code to paste in. Your job is to **recreate this design inside the
existing `bid-panel.tsx`** using the codebase's established patterns: React
Server Component form actions (`addSubtask`, `updateSubtask`, `removeSubtask`,
`submitBid`), the `SubmitButton` wrapper, the `Card`/`CardTitle` primitives, the
`DocAttach` child, and Tailwind v4 utility classes with the existing tokens.
The demo uses plain inline styles and hex values purely to communicate the spec;
translate those into Tailwind classes (equivalents given below).

## Fidelity
**High-fidelity.** Colors, spacing, radii, and typography are final. Recreate
pixel-for-pixel using Tailwind utilities. Every hex/px value below maps to an
existing token in `apps/web/app/globals.css` or a standard Tailwind class.

---

## The redesign vs. what exists today

Current `bid-panel.tsx` renders, in order:
1. `Your bid` title + `Submitted` badge, description paragraph.
2. A list of existing bid lines — each an inline `<form action={updateSubtask}>`
   with `flex flex-wrap items-end gap-2`, tiny `text-xs` inputs, a Save button
   and an `✕` remove button.
3. An add-step `<form action={addSubtask}>` with the same cramped row.
4. Total + Submit bid row.
5. `<DocAttach ... />`.

**Problem being fixed:** the inline fields have inconsistent widths/heights
(`w-16`, `w-24`, auto date/select), native number spinners, and the "Add" button
doesn't align — it looks unpolished.

**New structure (keep the same 5 blocks, restyle 2 & 3):**
1. Title + badge + description — unchanged copy, slightly larger type.
2. **Add-step form first**, styled as a bordered sub-card with labeled fields on
   a fixed grid (see Screen spec).
3. **Existing bid lines below**, each rendered as a compact **step card** (title
   + meta line + cost + remove), NOT an inline edit form. Editing can open a row
   into the same field layout as the add form, or keep inline-edit — your call,
   but the resting state is the read card shown here.
4. Total + Submit — unchanged logic, restyled.
5. `<DocAttach />` — unchanged, restyled trigger button (dashed border).

> Note: the demo shows step cards as read-only rows for clarity. The real
> component must preserve editability. Simplest faithful mapping: keep each step
> card as its `<form action={updateSubtask}>` but collapse it to the card
> presentation, with an "Edit" affordance (or make fields inline-editable within
> the card) and the `removeSubtask` button as the `✕`. Preserve all hidden
> inputs (`id`, `taskId`, `projectId`) and the completeness validation.

---

## Screen / View: Your bid panel

### Layout
- Outer container = existing `<Card>` (`rounded-lg border border-zinc-200
  bg-white p-5`). The demo uses `border-radius:14px; padding:28px` — you may bump
  the Card's padding for this panel, but the standard `Card` is acceptable. Max
  width follows the parent column (demo shows 640px).
- Vertical rhythm between blocks: `mt-*` matching the demo (title→desc 8px,
  desc→form 22px, form→cards 16px, cards→total 22px, total→docs 20px).

### Components

**1. Header**
- Title: text `Your bid`. `text-[17px] font-semibold text-zinc-900` (currently
  `CardTitle` = `text-sm`; increase to 17px for this panel, or keep `CardTitle`).
- Status badge (only when `submitted`): pill, `rounded-full bg-zinc-100 px-2.5
  py-1 text-[11px] font-semibold text-zinc-500` reading `Submitted`. Keep the
  existing green `Submitted` treatment if you prefer — copy unchanged.
- Description paragraph: unchanged copy. `mt-2 text-[13.5px] leading-[1.55]
  text-zinc-500` with `text-wrap:pretty`.

**2. Add-step form** — bordered sub-card
- Wrapper: `mt-[22px] rounded-xl border border-zinc-200 bg-zinc-50/60 p-[18px]`.
  Demo bg `#fbfbfc` ≈ `bg-zinc-50`.
- Field #1 (full width): label `Step` + text input, `name="title"`, required,
  placeholder `e.g. Excavate footing`.
- Then a 2-column grid (`grid grid-cols-2 gap-x-4 gap-y-[14px] items-end
  mt-[14px]`):
  - **Duration** cell: label `Duration`, then a flex row (`flex gap-2`) of a
    number input (`name="estQty"`, `min=0 step=0.5`, flex-1) + a `select`
    (`name="estUnit"`, fixed `w-[104px]`, options `day(s)` / `hours`,
    default `days`).
  - **Start** cell: label `Start`, `type="date"` input, `name="plannedStartDate"`,
    with `min={taskStart}` `max={taskEnd}` preserved.
  - **Cost ($)** cell: label `Cost ($)`, number input `name="cost"`,
    `min=0 step=0.01`, placeholder `0.00`, **right-aligned text**
    (`text-right`), `tabular-nums`.
  - **Action** cell: the `SubmitButton` (primary), full-width, label `Add`
    / `Adding…`. Aligned to the bottom of the grid row (`items-end`).
- All labels: `block text-[11.5px] font-semibold text-zinc-500 mb-1.5`.

**3. Existing step cards** (`mt-4 flex flex-col gap-2.5`)
- One card per bid line: `flex items-center gap-3.5 rounded-[10px] border
  border-zinc-200 px-4 py-[13px]`.
- Left (flex-1, min-w-0): title `text-sm font-semibold text-zinc-900`; meta line
  below `text-[12.5px] text-zinc-400 mt-0.5` formatted like
  `"{estQty} {unit} · starts {DD/MM/YYYY}"`.
- Cost: `text-[15px] font-bold text-zinc-900 tabular-nums`, formatted with
  `formatUsd(costCents)`.
- Remove: `✕` button → `removeSubtask`. Resting `text-zinc-400`, hover
  `bg-red-50 text-red-500`, `w-7 h-7 rounded-md`.

**4. Total + Submit** (`mt-[22px] pt-5 border-t border-zinc-100 flex items-center
justify-between`)
- Left: `Your total` in `text-sm text-zinc-500` + value `text-xl font-bold
  text-zinc-900 tabular-nums` via `formatUsd(total)`.
- Right: primary `SubmitButton` → `submitBid`, label `Submit bid` / `Update bid`
  (when `submitted`), `pendingText="Submitting…"`, `disabled` when
  `bidLines.length === 0 || incomplete`. Style: `h-[42px] px-[26px] rounded-[9px]
  bg-brand-500 hover:bg-brand-600 text-white text-[14.5px] font-semibold`.
- Keep the amber incomplete-warning `<p>` beneath, unchanged.

**5. DocAttach** — unchanged component; restyle the trigger button to a **dashed**
outline: `inline-flex items-center gap-2 h-[38px] px-4 rounded-lg border border-
dashed border-zinc-300 text-[13.5px] font-medium text-zinc-700`, hover
`border-brand-500 bg-brand-50 text-brand-600`. Section label unchanged
(`BoQ / invoice (PDF, Excel, CSV)` uppercase).

---

## Interactions & Behavior
- **Add step:** `addSubtask` server action; form has hidden `taskId` +
  `bid="1"`. Fields reset on success (existing behavior).
- **Edit/Save step:** `updateSubtask` with hidden `id`, `taskId`, `projectId`.
- **Remove step:** `removeSubtask` via `formAction` on the `✕`.
- **Submit bid:** `submitBid` with hidden `taskId`, `projectId`. Disabled unless
  at least one line AND all lines complete (`costCents > 0`, `estQty > 0`,
  `estUnit` set, `plannedStartDate` set) — this is the existing `incomplete`
  check; keep it verbatim.
- **Focus state (all inputs/selects):** border → `brand-500` + a 3px focus ring
  `box-shadow: 0 0 0 3px rgba(37,99,235,.12)`. Use Tailwind
  `focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15`.
- **Number spinners removed:** apply `appearance-none [&::-webkit-inner-spin-
  button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none` (or a
  small utility) so native steppers don't show. Duration/Cost are plain number
  fields.
- **Select caret:** custom chevron (the design removes the native select arrow
  and draws a zinc-500 chevron 12px on the right). Tailwind: `appearance-none` +
  a background-image chevron, or an absolutely-positioned icon.
- Hover states as specified per button above. `SubmitButton` keeps its spinner +
  `aria-busy` pending behavior.

## State Management
No new state. All data + mutations already flow through the existing props
(`bidLines`, `docs`, `submitted`, `taskStart`, `taskEnd`) and server actions.
The `total` and `incomplete` are computed in-component exactly as today.

## Design Tokens
All present in `apps/web/app/globals.css` / standard Tailwind:
- Brand: `--color-brand-50 #eff6ff`, `--color-brand-500 #2563eb`,
  `--color-brand-600 #1d4ed8`.
- Neutrals (zinc): text `#18181b` (900), `#3f3f46` (700), `#71717a` (500),
  `#a1a1aa` (400); borders `#e4e4e7` (200) / `#f4f4f5` (100); surfaces `#ffffff`,
  `#fafafa`/`#fbfbfc` (≈ zinc-50).
- Danger: `#ef4444` (red-500) / `#fef2f2` (red-50) for remove hover.
- Radii: fields `8px` (`rounded-lg`), step card `10px`, sub-card `12px` (`rounded-
  xl`), submit `9px`.
- Field height: **40px** everywhere (`h-10`). Submit/total buttons `42px`,
  secondary buttons `38px`.
- Type scale: 17 / 15 / 14 / 13.5 / 12.5 / 11.5 / 11 px. Weights 400/500/600/700.
- Numeric values (cost, total, duration): `tabular-nums`.
- Font: `--font-sans` (system UI stack), already the app default.

## Assets
None. The paperclip (📎) is an emoji placeholder — swap for the codebase's icon
set (e.g. a `lucide-react` `Paperclip`) if one is in use; likewise the `✕` and
select chevron can use the existing icon library.

## Files
- `BidPanel-redesign.dc.html` — the HTML design reference in this bundle (open in
  a browser to see the target look and the field/focus behavior).
- Source component to edit: `apps/web/components/task/bid-panel.tsx`.
- Unchanged collaborators for reference: `apps/web/components/ui/card.tsx`,
  `.../ui/button.tsx`, `.../ui/submit-button.tsx`, `.../task/doc-attach.tsx`,
  and the actions in `apps/web/app/(app)/projects/[projectId]/tasks/actions.ts`.
