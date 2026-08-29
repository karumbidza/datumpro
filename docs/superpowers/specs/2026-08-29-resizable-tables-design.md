# Adjustable Table Columns — reusable hook + BOQ builder

**Date:** 2026-08-29
**Status:** Approved (design)
**Branch:** `feat/resizable-tables` (stacked on `feat/boq-review-grid-excel` / PR #39, which introduced the resize logic being generalised).

## Goal

Generalise the Excel-style column resizing built for the import review grid into a reusable hook, apply it to the **BOQ builder** table (`/boq/<id>`), widen the BOQ page a notch, shrink the Description column's default, and add hover-peek (full-text tooltip) for narrowed cells. The other ~8 wide tables are a follow-up.

## Decisions (from brainstorming)

- Page width: **7xl** (add option to `PageContainer`, apply to the BOQ builder page).
- Long text: **both** — draggable/persistent column widths AND a `title` tooltip on narrowed cells.
- Rollout: **builder now + reusable hook**, and refactor the importer grid to consume the hook (DRY). Other tables later.

## Architecture

**New shared hook** `apps/web/lib/use-column-resize.ts` (client hook; consumers are `'use client'`):

```ts
useColumnResize(storageKey: string, defaults: number[], opts?: { min?: number; max?: number })
  → { widths: number[]; totalWidth: number; startResize(i, e): void; autoFit(i, texts: string[]): void; setWidths }
```

Responsibilities (moved out of `review-grid.tsx`, unchanged in behaviour):
- Holds `widths` state (init `defaults`).
- Hydrates from `localStorage[storageKey]` in a `useEffect` (SSR-safe), validating: array, right length, every entry a finite number within `[min, max]` (the hardening already added).
- `persist(w)` writes back in try/catch.
- `startResize(i, e)` — pointer-drag on a header handle; clamps to `[min, max]`; persists on pointer-up. Window listeners added/removed as a matched pair so the drag survives the pointer leaving the handle.
- `autoFit(i, texts)` — canvas `measureText` over the supplied strings, sets the column to the widest + padding (clamped), persists. Caller supplies the column's cell texts.
- Defaults: `min = 48`, `max = 800`.

Each consuming table supplies a unique `storageKey` and a `defaults` array, renders `<colgroup>` from `widths`, sets the table to `tableLayout: 'fixed'` with `width: totalWidth`, and puts a handle in each resizable header cell.

## Components / changes

### 1. `apps/web/lib/use-column-resize.ts` (new)
The hook above. Imports `useEffect`, `useState` from react and `type { PointerEvent as ReactPointerEvent }` for the handler param. No JSX.

### 2. `review-grid.tsx` (refactor to consume the hook — no behaviour change)
- Replace the local `colWidths` state + `LS_KEY`/hydrate effect + `persist` + `startColResize` + `autoFitCol` with:
  ```ts
  const { widths: colWidths, totalWidth, startResize, autoFit } =
    useColumnResize(`boq-review-colw:${boqId}`, DEFAULT_COL_W, { min: 48, max: 800 });
  ```
- Header handles: `onPointerDown={(e) => startResize(i, e)}`, `onDoubleClick={() => autoFit(i, textsForCol(i))}` where `textsForCol(i)` reproduces the previous per-column pick (`[r.kind, r.itemNo, r.description, r.unit, qty, rate, amount, ''][i]`).
- Everything else (row resize, overlays, rail, navigator, colgroup driven by `colWidths`, `totalWidth`) stays. `DEFAULT_COL_W` constant stays; `MIN_COL_W`/`MAX_COL_W` locals removed (now hook-internal) unless still referenced.
- Net: identical UX, ~40 fewer lines, single source of truth for resize.

### 3. `boq-builder.tsx` (add adjustable columns + hover-peek)
Current table (line ~482): `<table className="w-full min-w-[720px]…">` with a static `<colgroup>` of 8 cols (Item No, Description, Unit, Qty, Budget/Est, Days, Total, actions) and a sticky `<thead>`.
- Add: `const { widths, totalWidth, startResize, autoFit } = useColumnResize(`boq-builder-colw:${boqId}`, BUILDER_DEFAULT_W, { min: 40, max: 900 });`
- `const BUILDER_DEFAULT_W = [64, 320, 96, 96, 112, 64, 128, 36];` — Description reduced to 320 (was flex/uncapped); others keep today's sizes (w-16=64, w-24=96, w-28=112, w-9=36).
- Table → `style={{ tableLayout: 'fixed', width: totalWidth }}`, drop `w-full min-w-[720px]`. `<colgroup>` maps `widths` to `<col style={{ width }}>`.
- Header handle on each of the 7 visible header `<th>` (indices 0–6; the empty actions `<th>` index 7 needs none): a `relative` `<th>` with
  ```tsx
  <div onPointerDown={(e) => startResize(i, e)} onDoubleClick={() => autoFit(i, builderTexts(i))}
       className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50" />
  ```
  `builderTexts(i)` returns the visible cell strings for column i across all items (e.g. description → `items.map(x => x.description)`; itemNo, uom, qty, rate, days, total formatted). For columns where measuring is awkward, `autoFit` may be omitted (drag still works) — but provide it for at least Item No, Description, Unit.
- **Hover-peek:** add `title={it.description || undefined}` to the Description `<input>` (line ~289) so a narrowed cell shows full text on hover. The input stays uncontrolled (`defaultValue`); `it.description` reflects edits via `patchLocal`.
- Section/sub-section header rows use `colSpan` and reflow correctly under fixed layout — leave them as-is.
- Sticky `thead` already present — keep.

### 4. `page-container.tsx` (add 7xl)
- Extend `Width` type with `'7xl'` and `MAX` with `'7xl': 'max-w-7xl'`.

### 5. `boq/[boqId]/page.tsx`
- Change `<PageContainer width="6xl">` → `width="7xl"`.

## Error / edge handling
- SSR: hook hydration/persist only in `useEffect`/handlers, never render.
- Malformed/stale `localStorage`: rejected by the finite/in-range validation.
- A table with fewer/more real columns than `defaults.length`: caller's responsibility to match; the hook trusts `defaults.length`.
- `noUncheckedIndexedAccess` is ON — hook uses `widths[i] ?? defaults[i] ?? min`; consumers guard indexed DOM access.
- Fixed layout clips overflow — that's why hover-peek (`title`) and resize exist.

## Testing
No unit harness for these client components. Gates per change: `pnpm -C apps/web typecheck` + `eslint` on changed files clean; full `next build` green at the end (move untracked `app/api/admin/*` aside during build). Manual, against Magunje Build:
1. Importer review grid still resizes/persists/auto-fits exactly as before (refactor is behaviour-neutral).
2. BOQ builder: drag a column border → resizes; reload → persists; double-click → auto-fits; Description default is narrower; hovering a clipped description shows full text; section rows still render correctly; sticky header intact; totals unchanged.
3. BOQ page is visibly wider (7xl).

## Out of scope
- The other wide tables (tender comparison, bidders panel, boq-board, finance, bid-workspace, approval matrix) — follow-up PRs, each a small hook adoption.
- Row-height resize on the builder (only the importer has it). Virtualization.
