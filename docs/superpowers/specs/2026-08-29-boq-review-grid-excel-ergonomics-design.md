# BOQ Review Grid — Excel-style Ergonomics

**Date:** 2026-08-29
**Status:** Approved (design)
**Scope:** The **review** step of the BOQ Excel importer only (`apps/web/app/(app)/boq/[boqId]/import/boq-importer.tsx`, table at lines ~548–643). The map-step grid and all import/data logic are untouched. Pure client-side view ergonomics — import output is byte-for-byte identical.

## Goal

Make the 552-row / 318-section review grid feel like a spreadsheet: resizable column **and** row borders, a faint cross-highlight of the active row + column, a frozen header on scroll, and two fast-navigation aids (section jump + draggable scroll rail).

## Architecture

Extract the review table into a new focused component:

- **`apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`** — owns all interaction state and rendering of the review table.
  - Props: `{ rows: Row[]; setRow: (i: number, patch: Partial<Row>) => void; currency: string }`.
  - `Row` and `fmtMoney`/`lineCents` are imported from their existing homes (share, don't duplicate). If `Row`/`Kind` types are declared locally in `boq-importer.tsx`, export them so the grid can import them.
- **`boq-importer.tsx`** — replaces the inline `<table>…</table>` block in the review step with `<ReviewGrid rows={rows} setRow={setRow} currency={currency} />`. Header text, totals line, replace checkbox, and action buttons stay in the importer.

The grid renders one bounded scroll container holding: the section navigator (sticky, above the table), the `<table>` with a frozen `<thead>`, two highlight overlay rectangles, and the custom scroll rail.

## Components / interaction units

Each unit is independent and testable on its own.

### 1. Frozen header + bounded scroll box
- Scroll container: `className="relative max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border …"`. `relative` anchors the overlays and rail.
- `<thead>`: `className="sticky top-0 z-20"`; header cells keep an **opaque** background (`bg-zinc-100 dark:bg-zinc-800` — no translucency, or rows show through).
- This bounded box is the scroll parent everything else (rail, section jump, overlays) measures against.

### 2. Resizable columns
- `<table>` gets `style={{ tableLayout: 'fixed', width: totalWidth }}` and a `<colgroup>` of 8 `<col>` elements with `style={{ width: colWidths[i] }}`.
- `colWidths: number[]` state, length 8. Defaults: `[96, 72, 360, 72, 88, 104, 120, 120]` (Kind, No., Description, Unit, Qty, Rate, Amount, Total). `totalWidth = sum(colWidths)`.
- Each `<th>` has a 6px grab-handle `<div>` on its right edge (`absolute right-0 top-0 h-full w-1.5 cursor-col-resize`). Pointer flow: `onPointerDown` captures the pointer (`setPointerCapture`), records `startX` + `startWidth`; `onPointerMove` sets `colWidths[i] = clamp(startWidth + dx, MIN=48, MAX=800)`; `onPointerUp` releases + persists.
- **Double-click a handle** → auto-fit: set that column's width to fit its widest visible cell (measure via a hidden canvas `measureText`, or a transient `scrollWidth` read; clamp to MAX).
- Persist `colWidths` to `localStorage` key `boq-review-colw:${boqId}` on change; hydrate on mount (guarded for SSR — read in `useEffect`).

### 3. Resizable rows
- `rowHeights: Map<number, number>` — **sparse**; only rows the user dragged appear. Default height comes from CSS (unset).
- Each row renders a grab-handle on its bottom border (a `<div className="absolute inset-x-0 bottom-0 h-1.5 cursor-row-resize">` inside a `position: relative` first cell, or an overlay handle keyed to the row). Pointer flow mirrors columns: drag sets `rowHeights.set(i, clamp(startH + dy, MIN=28, MAX=400))`; apply as `<tr style={{ height }}>`.
- The **Description cell becomes a `<textarea>`** (replacing its `<input>`): `rows={1}`, `resize-none`, `className` keeps the existing look, `overflow` visible so a taller row reveals wrapped text. Value/onChange unchanged (`setRow(i, { description })`). Other cells stay `<input>`.
- **Double-click a row handle** → `rowHeights.delete(i)` (reset to default). Row heights are session-only (not persisted — they're per-review-pass).

### 4. Cross-highlight overlays
- `active: { row: number; col: number } | null`. Set on `focus`/`click` of any cell; each cell knows its `col` (0–7) from its map index, and its `row` from the row index.
- Two absolutely-positioned rectangles inside the scroll container, behind the table (`z-0`, table content `z-10`, pointer-events-none):
  - **Row band**: full table width, positioned at the active row's `offsetTop`, height = active row's `offsetHeight`.
  - **Column band**: full table height, positioned at the active column's left offset (`sum(colWidths[0..col-1])`), width `colWidths[col]`.
  - Fill: very faint brand tint — `background: rgb(from var(--brand-500) r g b / 0.06)` or Tailwind `bg-brand-500/[0.06]`. Active-cell intersection can read one step stronger (optional).
- Measure the active row's `offsetTop`/`offsetHeight` from the focused cell's DOM (`el.parentElement` = `<tr>`) relative to the table; recompute on `active` change, on resize (col/row), and on scroll is unnecessary (overlays live inside the scrolled content, so they move with it). Store as `{ rowTop, rowH, colLeft, colW }`.
- Clicking outside the grid (container `onBlur` when focus leaves) clears `active`.

### 5. Quick scroll — section navigator
- Above the table, inside the container but `sticky top-0 z-30` (above the frozen header) OR just above the scroll box (simpler; choose above the box so it doesn't fight the header — **place it above the scroll box**).
- A combobox: text input filtering a dropdown of all `rows` where `kind === 'section'`, showing `description`, tracked by row index. Picking one scrolls that row to just under the frozen header: `container.scrollTop = rowEl.offsetTop - theadHeight`.
- Keep a `rowRefs` mechanism: a `Map<number, HTMLTableRowElement>` populated via `ref` callback, or query `tbody.children[i]`.

### 6. Quick scroll — draggable rail
- A custom thumb overlaid on the container's right edge (`absolute right-0.5 top-0 w-2 z-30`). Thumb height = `(clientHeight / scrollHeight) * trackHeight`; thumb top = `(scrollTop / scrollHeight) * trackHeight`.
- Drag: `onPointerDown` on the thumb captures pointer; `onPointerMove` maps `dy` → `container.scrollTop = (thumbTop / trackHeight) * scrollHeight`.
- While dragging, show a floating bubble near the thumb: `` `${firstVisibleRow} / ${rows.length}` `` where `firstVisibleRow` ≈ index of the row at `scrollTop`.
- Keep the thumb in sync with normal wheel/trackpad scroll via the container's `onScroll`.
- The native scrollbar can remain (harmless) or be hidden with `scrollbar-width: none`; **keep native** for accessibility — the rail is an enhancement, not a replacement.

## Error / edge handling
- SSR: all `localStorage`/DOM measurement runs in `useEffect`, never during render.
- Empty grid (`rows.length === 0`): navigator + rail render nothing/disabled; no crash.
- Section rows and skip rows: unchanged styling (`bg-zinc-50` / `opacity-45`); row-resize handle still available; overlays highlight them like any row.
- Pointer capture guarantees drags survive the cursor leaving the handle; `onPointerUp`/`onLostPointerCapture` always ends a drag.
- Min/max clamps prevent zero-width columns or collapsed rows.

## Performance
- Overlay-based highlight means a cell focus updates only `active` + overlay geometry — **no per-cell class churn**, no 552-row re-tag.
- Column/row resize updates one array/map entry; the `<colgroup>` reflow is cheap.
- All 552 rows already render today; this adds no new per-row React work beyond the textarea swap. Row virtualization is explicitly **out of scope** (noted for future multi-thousand-row bills).

## Testing
- Manual/visual (no unit-test harness for these client components in-repo): verify against the Magunje Build import (552 items):
  1. Drag a column border — width changes, persists after reload.
  2. Double-click a column handle — auto-fits.
  3. Drag a row border — row grows, Description wraps; double-click resets.
  4. Click a cell — faint row+column bands appear; move focus — bands follow; click out — clear.
  5. Scroll — header stays frozen; rail thumb tracks; drag rail — grid scrubs with `n / 552` bubble.
  6. Section navigator — pick a section — grid jumps to it under the header.
  7. Import still produces the same sections/items/total as before.
- Gate: `pnpm -C apps/web typecheck` and `eslint` on changed files clean.

## Out of scope
- The map-step grid. Row virtualization. Keyboard cell navigation (arrow-key movement) — could be a follow-up. Any change to parsing, mapping, or the import RPC.
