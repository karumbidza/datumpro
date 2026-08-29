# BOQ Review Grid — Excel Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the BOQ import **review** grid spreadsheet ergonomics — resizable column and row borders, a faint row/column cross-highlight, a frozen header, and two quick-scroll aids (section navigator + draggable rail).

**Architecture:** Extract the review table from the 668-line `boq-importer.tsx` into a focused `review-grid.tsx` client component that owns all interaction state (column widths, row heights, active cell, scroll refs). Cross-highlight is drawn with two absolutely-positioned overlay rectangles (not per-cell classes) so a cell focus never re-tags 4,400 inputs. Shared types + the `lineCents` helper move to `grid-types.ts` to avoid an import cycle.

**Tech Stack:** Next.js App Router client component, React `useState`/`useRef`/`useEffect`, Pointer Events API, Tailwind, `localStorage`.

**No test harness note:** These client components have no unit-test suite in-repo. Automated gate for every task is `pnpm -C apps/web typecheck` + `eslint` on changed files. Behavioural gates are explicit manual checks in the browser against the Magunje Build import (552 items) at `/boq/<id>/import`.

**Branch:** `feat/boq-review-grid-excel` (already created; spec already committed there).

**Guardrails:** Never `git add -A` — untracked `apps/web/app/api/admin/{analytics,flags,logs}/` have type errors and must never be staged. Stage only named files. A full typecheck may emit errors in `.next/types/validator.ts` referencing those admin routes — that noise is pre-existing and unrelated; treat typecheck as passing if the only errors reference `app/api/admin/*`.

---

## File Structure

- **Create** `apps/web/app/(app)/boq/[boqId]/import/grid-types.ts` — shared `Row`, `Kind` types and pure `lineCents(r)`. Imported by both `boq-importer.tsx` and `review-grid.tsx`.
- **Create** `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx` — the review table + all new interactions. Props `{ rows, setRow, currency }`.
- **Modify** `apps/web/app/(app)/boq/[boqId]/import/boq-importer.tsx` — import types/`lineCents` from `grid-types`; replace the inline review `<table>` block (lines ~548–643) with `<ReviewGrid rows={rows} setRow={setRow} currency={currency} />`.

`Row` shape (do not change): `{ kind: Kind; itemNo: string; description: string; unit: string; qty: number; rate: number; amount: number }`. `Kind = 'section' | 'item' | 'skip'`. `setRow` signature: `(i: number, patch: Partial<Row>) => void`. `fmtMoney` is imported from `@/lib/money`.

Column order + indices used throughout: `0 Kind · 1 No. · 2 Description · 3 Unit · 4 Qty · 5 Rate · 6 Amount · 7 Total`.

---

### Task 1: Extract shared types + `lineCents`; scaffold `ReviewGrid`; wire in (zero behaviour change)

**Files:**
- Create: `apps/web/app/(app)/boq/[boqId]/import/grid-types.ts`
- Create: `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`
- Modify: `apps/web/app/(app)/boq/[boqId]/import/boq-importer.tsx`

- [ ] **Step 1: Create `grid-types.ts`**

```ts
// Shared by boq-importer (parser/UI) and review-grid (spreadsheet view). Kept in
// its own module so review-grid can use lineCents without importing the importer
// (which would form a cycle, since the importer renders review-grid).

export type Kind = 'section' | 'item' | 'skip';

// A row carries qty/rate AND an amount; a lump-sum bill prices by amount alone
// (qty/rate may be text like "Item"/"Sum"), a measured bill by qty × rate.
export type Row = {
  kind: Kind;
  itemNo: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
};

/** The effective line total in cents. The Amount column is authoritative when
 *  present (real bills round or hand-enter it, so it can differ from qty × rate);
 *  fall back to qty × rate only when there is no amount. */
export function lineCents(r: Pick<Row, 'qty' | 'rate' | 'amount'>): number {
  const amount = r.amount > 0 ? r.amount : r.qty * r.rate;
  return Math.round(amount * 100);
}
```

> NOTE: Copy the **exact** body of the existing `lineCents` from `boq-importer.tsx` (around line 55) rather than the reconstruction above if it differs — open the file and match it verbatim, then delete the original.

- [ ] **Step 2: Update `boq-importer.tsx` to use the shared module**

In `boq-importer.tsx`: delete the local `type Kind`, `type Row`, and the `function lineCents` definitions. Add to the imports near line 10:

```ts
import { type Row, type Kind, lineCents } from './grid-types';
```

Keep everything else (`Cell`, `Grid`, `Sheet`, `Role`, other helpers) as-is.

- [ ] **Step 3: Create `review-grid.tsx` with the table moved verbatim**

Create the component and move the review table markup (currently `boq-importer.tsx` lines ~548–642, the `<div className="overflow-x-auto …"> … </table></div>`) into it **unchanged** except: `rows` → `props.rows`, `setRow` → `props.setRow`, `currency` → `props.currency`, `fmtMoney`/`lineCents` imported.

```tsx
'use client';

import { fmtMoney } from '@/lib/money';
import { type Row, lineCents } from './grid-types';

export function ReviewGrid({
  rows,
  setRow,
  currency,
}: {
  rows: Row[];
  setRow: (i: number, patch: Partial<Row>) => void;
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
      <table className="min-w-[860px] border-collapse text-sm">
        {/* ↓ paste the existing <thead>…</thead> and <tbody>…</tbody> verbatim,
            referencing rows / setRow / currency from props */}
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Render `ReviewGrid` from the importer**

In `boq-importer.tsx`, add `import { ReviewGrid } from './review-grid';` and replace the inline review `<div className="overflow-x-auto …">…</div>` block with:

```tsx
<ReviewGrid rows={rows} setRow={setRow} currency={currency} />
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -C apps/web typecheck` — Expected: clean (ignore only `app/api/admin/*` / `.next/types/validator.ts` noise).
Run: `pnpm -C apps/web exec eslint app/\(app\)/boq/\[boqId\]/import/review-grid.tsx app/\(app\)/boq/\[boqId\]/import/grid-types.ts app/\(app\)/boq/\[boqId\]/import/boq-importer.tsx` — Expected: no output.

- [ ] **Step 6: Manual check** — load `/boq/<id>/import`, reach the review step: the table renders **identically** to before (same columns, editing works). No visual change yet.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/grid-types.ts" \
        "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx" \
        "apps/web/app/(app)/boq/[boqId]/import/boq-importer.tsx"
git commit -m "refactor(boq): extract ReviewGrid + shared grid-types (no behaviour change)"
```

---

### Task 2: Frozen header + bounded scroll + fixed layout + `<colgroup>`

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Add default column widths + refs**

At the top of the component body:

```tsx
import { useRef, useState } from 'react';

const DEFAULT_COL_W = [96, 72, 360, 72, 88, 104, 120, 120]; // Kind No Desc Unit Qty Rate Amount Total
const MIN_COL_W = 48;
const MAX_COL_W = 800;
```

Inside the component:

```tsx
const scrollRef = useRef<HTMLDivElement>(null);
const [colWidths, setColWidths] = useState<number[]>(DEFAULT_COL_W);
const totalWidth = colWidths.reduce((a, b) => a + b, 0);
```

- [ ] **Step 2: Bounded, relative scroll container + fixed table + colgroup**

Change the wrapper and table:

```tsx
<div
  ref={scrollRef}
  className="relative max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-zinc-300 dark:border-zinc-700"
>
  <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: totalWidth }}>
    <colgroup>
      {colWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
    <thead className="sticky top-0 z-20">
      {/* header row unchanged EXCEPT the <tr> background must be opaque so body
          rows don't show through while scrolling: */}
      <tr className="bg-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {/* …existing <th> cells unchanged… */}
      </tr>
    </thead>
    {/* tbody unchanged */}
  </table>
</div>
```

Remove the old `min-w-[860px]` (fixed layout + `width: totalWidth` replaces it). Because `table-layout: fixed`, the Description cells will now clip — that's expected; Task 3 lets the user widen them, Task 4's textarea wraps them.

- [ ] **Step 3: Typecheck + lint** (same commands as Task 1 Step 5). Expected clean.

- [ ] **Step 4: Manual check** — review step: the grid is now a bounded box; scrolling the body keeps the **header row frozen** at the top. Columns render at the default widths.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "feat(boq): frozen header + fixed-layout colgroup on review grid"
```

---

### Task 3: Resizable columns (drag handle + persist + double-click auto-fit)

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Hydrate/persist column widths in `localStorage`**

Add `useEffect` import. Key by boqId — so add a `boqId` prop (thread it from the importer: `<ReviewGrid boqId={boqId} …/>`, and add `boqId: string` to props; the importer already has `boqId`).

```tsx
const LS_KEY = `boq-review-colw:${boqId}`;

useEffect(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length === DEFAULT_COL_W.length) setColWidths(saved);
  } catch {
    /* ignore malformed cache */
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [LS_KEY]);

function persist(widths: number[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(widths));
  } catch {
    /* storage full / disabled — fine, widths still apply this session */
  }
}
```

- [ ] **Step 2: Column drag handler (Pointer Events)**

```tsx
function startColResize(i: number, e: React.PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = colWidths[i];
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  function move(ev: PointerEvent) {
    const next = Math.min(MAX_COL_W, Math.max(MIN_COL_W, startW + (ev.clientX - startX)));
    setColWidths((prev) => {
      const out = [...prev];
      out[i] = next;
      return out;
    });
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    setColWidths((prev) => {
      persist(prev);
      return prev;
    });
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
```

- [ ] **Step 3: Auto-fit on double-click**

```tsx
// Widen a column to fit its widest cell text, measured with a canvas (no reflow).
function autoFitCol(i: number) {
  const canvas = (autoFitCol as any)._c || ((autoFitCol as any)._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d')!;
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
  let max = MIN_COL_W;
  const pick = (r: Row): string =>
    [r.kind === 'section' ? r.description : '', r.itemNo, r.description, r.unit, String(r.qty || ''), String(r.rate || ''), String(r.amount || ''), ''][i] || '';
  for (const r of rows) max = Math.max(max, ctx.measureText(pick(r)).width + 28); // +padding
  const next = Math.min(MAX_COL_W, Math.ceil(max));
  setColWidths((prev) => {
    const out = [...prev];
    out[i] = next;
    persist(out);
    return out;
  });
}
```

- [ ] **Step 4: Render a handle on each header cell**

Each `<th>` becomes `relative`; append a handle. The Total column (index 7) may keep a handle too. Example for a header cell (repeat per column with its index):

```tsx
<th className="relative border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">
  Description
  <div
    onPointerDown={(e) => startColResize(2, e)}
    onDoubleClick={() => autoFitCol(2)}
    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
  />
</th>
```

- [ ] **Step 5: Typecheck + lint.** Expected clean.

- [ ] **Step 6: Manual check** — drag any column border → it resizes (clamped, doesn't collapse). Reload → widths persist. Double-click a handle → column auto-fits its content.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx" "apps/web/app/(app)/boq/[boqId]/import/boq-importer.tsx"
git commit -m "feat(boq): drag-resizable columns with persistence + auto-fit on review grid"
```

---

### Task 4: Resizable rows (bottom-border handle + Description textarea + reset)

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Sparse row-height state**

```tsx
const MIN_ROW_H = 28;
const MAX_ROW_H = 400;
const [rowHeights, setRowHeights] = useState<Map<number, number>>(new Map());
```

- [ ] **Step 2: Row drag handler**

```tsx
function startRowResize(i: number, e: React.PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const tr = (e.currentTarget as HTMLElement).closest('tr') as HTMLTableRowElement | null;
  const startH = tr?.offsetHeight ?? MIN_ROW_H;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  function move(ev: PointerEvent) {
    const next = Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, startH + (ev.clientY - startY)));
    setRowHeights((prev) => new Map(prev).set(i, next));
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function resetRow(i: number) {
  setRowHeights((prev) => {
    const out = new Map(prev);
    out.delete(i);
    return out;
  });
}
```

- [ ] **Step 3: Apply height + a bottom handle inside the Kind cell (col 0, which is `relative`)**

On each `<tr>`: `style={{ height: rowHeights.get(i) }}` (undefined → default). Inside the first `<td>` (Kind), which must be `relative`, add:

```tsx
<div
  onPointerDown={(e) => startRowResize(i, e)}
  onDoubleClick={() => resetRow(i)}
  className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-row-resize touch-none select-none hover:bg-brand-400/50"
/>
```

- [ ] **Step 4: Swap the Description `<input>` for a `<textarea>`**

Replace the Description cell's `<input>` with a textarea so a taller row reveals wrapped text:

```tsx
<textarea
  value={r.description}
  onChange={(e) => setRow(i, { description: e.target.value })}
  rows={1}
  className={`h-full w-full resize-none bg-transparent px-2 py-1.5 leading-snug outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 ${isSection ? 'font-semibold' : ''}`}
/>
```

(The cell keeps `p-0`; `h-full` lets the textarea fill a resized row. Default row shows one line.)

- [ ] **Step 5: Typecheck + lint.** Expected clean.

- [ ] **Step 6: Manual check** — drag a row's bottom border → row grows and the long Description wraps/shows more; double-click the handle → resets to one line. Column resize still works.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "feat(boq): drag-resizable rows + wrapping description textarea on review grid"
```

---

### Task 5: Cross-highlight overlays (faint active row + column)

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Active-cell state + geometry**

```tsx
const [active, setActive] = useState<{ row: number; col: number } | null>(null);
const [band, setBand] = useState<{ rowTop: number; rowH: number; colLeft: number; colW: number } | null>(null);
const tableRef = useRef<HTMLTableElement>(null);
```

Add `ref={tableRef}` to `<table>`.

- [ ] **Step 2: Compute bands when active/layout changes**

```tsx
useEffect(() => {
  if (!active || !tableRef.current) {
    setBand(null);
    return;
  }
  const tbody = tableRef.current.tBodies[0];
  const tr = tbody?.children[active.row] as HTMLElement | undefined;
  if (!tr) {
    setBand(null);
    return;
  }
  const colLeft = colWidths.slice(0, active.col).reduce((a, b) => a + b, 0);
  setBand({ rowTop: tr.offsetTop, rowH: tr.offsetHeight, colLeft, colW: colWidths[active.col] });
}, [active, colWidths, rowHeights, rows.length]);
```

`tr.offsetTop` is relative to the table (its offset parent), which is inside the scroll container — so the overlay scrolls naturally with the content.

- [ ] **Step 3: Mark active on focus; each cell passes its col index**

Give every editable cell (input/select/textarea) an `onFocus={() => setActive({ row: i, col: <COL_INDEX> })}`. Col indices: Kind select=0, No input=1, Description textarea=2, Unit=3, Qty=4, Rate=5, Amount=6. (Total col 7 has no input; clicking it needn't set active.)

Clear when focus leaves the grid — on the scroll container:

```tsx
onBlur={(e) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node)) setActive(null);
}}
```

- [ ] **Step 4: Render the two overlay rectangles**

Immediately inside the scroll container, **before** the `<table>` (so they paint behind; table cells sit above with their own stacking). They must not intercept clicks:

```tsx
{band && (
  <>
    <div
      className="pointer-events-none absolute left-0 z-0 bg-brand-500/[0.06]"
      style={{ top: band.rowTop, height: band.rowH, width: totalWidth }}
    />
    <div
      className="pointer-events-none absolute top-0 z-0 bg-brand-500/[0.06]"
      style={{ left: band.colLeft, width: band.colW, height: tableRef.current?.offsetHeight ?? 0 }}
    />
  </>
)}
```

Ensure the `<table>` establishes a higher stacking context than the overlays: add `relative z-10` to the `<table>`'s className so inputs remain clickable and text readable above the tint.

- [ ] **Step 5: Typecheck + lint.** Expected clean.

- [ ] **Step 6: Manual check** — click/focus any cell → a faint brand-tinted band highlights its whole row and whole column; moving focus moves the bands; resizing a column/row keeps them aligned; clicking outside the grid clears them. Inputs remain fully editable (overlays don't block clicks).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "feat(boq): faint row+column cross-highlight via overlay bands"
```

---

### Task 6: Quick scroll — section navigator

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Build the section list (memoised)**

```tsx
import { useMemo } from 'react';

const sections = useMemo(
  () => rows.map((r, i) => ({ i, label: r.description })).filter(({ i }) => rows[i].kind === 'section'),
  [rows],
);
const [navQuery, setNavQuery] = useState('');
const [navOpen, setNavOpen] = useState(false);
const filtered = navQuery
  ? sections.filter((s) => s.label.toLowerCase().includes(navQuery.toLowerCase()))
  : sections;
```

- [ ] **Step 2: Scroll-to-section**

```tsx
function jumpTo(rowIndex: number) {
  const box = scrollRef.current;
  const tbody = tableRef.current?.tBodies[0];
  const tr = tbody?.children[rowIndex] as HTMLElement | undefined;
  const thead = tableRef.current?.tHead as HTMLElement | undefined;
  if (!box || !tr) return;
  box.scrollTop = tr.offsetTop - (thead?.offsetHeight ?? 0);
  setNavOpen(false);
  setNavQuery('');
}
```

- [ ] **Step 3: Render the combobox ABOVE the scroll box**

Wrap the component's return in a fragment/div with the navigator first, then the scroll container:

```tsx
<div className="space-y-2">
  <div className="relative max-w-xs">
    <input
      value={navQuery}
      onChange={(e) => {
        setNavQuery(e.target.value);
        setNavOpen(true);
      }}
      onFocus={() => setNavOpen(true)}
      onBlur={() => setTimeout(() => setNavOpen(false), 120)}
      placeholder={`Jump to section… (${sections.length})`}
      className={inputCompactClass}
    />
    {navOpen && filtered.length > 0 && (
      <ul className="absolute z-40 mt-1 max-h-72 w-72 overflow-auto rounded-md border border-zinc-300 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {filtered.slice(0, 200).map((s) => (
          <li key={s.i}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo(s.i)}
              className="block w-full truncate px-3 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-zinc-800"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>

  <div ref={scrollRef} className="relative max-h-[calc(100vh-18rem)] overflow-auto rounded-lg border …">
    {/* overlays + table */}
  </div>
</div>
```

Import `inputCompactClass` from `@/components/ui/form`. (`onMouseDown preventDefault` keeps the input from blurring before the click registers. Cap the list at 200 for very long bills.)

- [ ] **Step 4: Typecheck + lint.** Expected clean.

- [ ] **Step 5: Manual check** — type part of a section name → filtered list; click one → grid scrolls so that section sits just under the frozen header.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "feat(boq): section-jump navigator above the review grid"
```

---

### Task 7: Quick scroll — draggable scroll rail

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

- [ ] **Step 1: Track scroll metrics**

```tsx
const [metrics, setMetrics] = useState({ scrollTop: 0, scrollH: 0, clientH: 0 });
function syncMetrics() {
  const b = scrollRef.current;
  if (b) setMetrics({ scrollTop: b.scrollTop, scrollH: b.scrollHeight, clientH: b.clientHeight });
}
useEffect(() => {
  syncMetrics();
}, [rows.length, colWidths, rowHeights]);
```

Add `onScroll={syncMetrics}` to the scroll container.

- [ ] **Step 2: Compute thumb geometry + dragging state**

```tsx
const [dragging, setDragging] = useState(false);
const trackH = metrics.clientH;
const thumbH = metrics.scrollH > 0 ? Math.max(28, (metrics.clientH / metrics.scrollH) * trackH) : 0;
const thumbTop = metrics.scrollH > metrics.clientH
  ? (metrics.scrollTop / (metrics.scrollH - metrics.clientH)) * (trackH - thumbH)
  : 0;
const showRail = metrics.scrollH > metrics.clientH + 4;
// First visible row index for the bubble:
const firstVisible = (() => {
  const tbody = tableRef.current?.tBodies[0];
  if (!tbody) return 0;
  for (let k = 0; k < tbody.children.length; k++) {
    if ((tbody.children[k] as HTMLElement).offsetTop >= metrics.scrollTop) return k + 1;
  }
  return rows.length;
})();
```

- [ ] **Step 3: Rail drag handler**

```tsx
function startRailDrag(e: React.PointerEvent) {
  e.preventDefault();
  setDragging(true);
  const startY = e.clientY;
  const startScroll = metrics.scrollTop;
  const box = scrollRef.current!;
  const denom = trackH - thumbH || 1;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  function move(ev: PointerEvent) {
    const frac = (ev.clientY - startY) / denom;
    box.scrollTop = startScroll + frac * (metrics.scrollH - metrics.clientH);
    syncMetrics();
  }
  function up() {
    setDragging(false);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
```

- [ ] **Step 4: Render the rail + bubble inside the scroll container**

The rail is `sticky`-like via `position: absolute` pinned to the visible viewport of the scroll box — simplest robust approach: place it as a sibling of the scroll box in a `relative` wrapper so it stays put while the box scrolls. Put the rail in the outer `space-y-2` wrapper, positioned over the scroll box:

```tsx
<div className="relative">
  <div ref={scrollRef} onScroll={syncMetrics} className="max-h-[calc(100vh-18rem)] overflow-auto …">
    {/* overlays + table */}
  </div>
  {showRail && (
    <div className="pointer-events-none absolute right-1 top-0 h-full w-3">
      <div
        onPointerDown={startRailDrag}
        style={{ height: thumbH, transform: `translateY(${thumbTop}px)` }}
        className="pointer-events-auto absolute right-0 w-2.5 cursor-grab rounded-full bg-zinc-400/70 hover:bg-zinc-500 active:cursor-grabbing dark:bg-zinc-500/70"
      />
      {dragging && (
        <div
          style={{ transform: `translateY(${thumbTop}px)` }}
          className="pointer-events-none absolute right-5 rounded bg-zinc-800 px-2 py-1 font-mono text-[11px] text-white shadow"
        >
          {firstVisible} / {rows.length}
        </div>
      )}
    </div>
  )}
</div>
```

(Keep the native scrollbar too — the rail is an enhancement. The cross-highlight overlays stay **inside** `scrollRef`; the rail lives in the `relative` wrapper OUTSIDE the scrolled content so it doesn't scroll away.)

- [ ] **Step 5: Typecheck + lint.** Expected clean.

- [ ] **Step 6: Manual check** — a fat thumb sits on the right; wheel-scrolling moves it; dragging it scrubs the grid and shows a floating `n / 552` bubble; releasing keeps position. Header still frozen; navigator + highlight + resize all still work.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "feat(boq): draggable scroll rail with position bubble on review grid"
```

---

## Final verification (after all tasks)

- [ ] Full manual pass of the spec's Testing checklist (items 1–7) against the Magunje Build import.
- [ ] Confirm **import output is unchanged**: click Import and verify it still reports the same `N sections · M items · $total` and lands the same data (compare to a pre-change import if unsure).
- [ ] `pnpm -C apps/web typecheck` + `pnpm -C apps/web build` clean (build catches client/server boundary issues; ignore only the `app/api/admin/*` noise).
- [ ] Dispatch a final code-review subagent over the whole branch diff, then use superpowers:finishing-a-development-branch.
```
