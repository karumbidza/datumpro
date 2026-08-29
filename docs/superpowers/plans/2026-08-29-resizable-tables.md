# Adjustable Table Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalise Excel-style column resizing into a reusable `useColumnResize` hook, apply it to the BOQ builder table (with hover-peek + a narrower Description default), widen the BOQ page to 7xl, and refactor the importer grid to consume the hook.

**Architecture:** A shared client hook owns column-width state, pointer-drag resize, `localStorage` persistence, and canvas auto-fit. Each table renders `<colgroup>` from the hook's `widths` under `table-layout: fixed` and puts a drag-handle on each header cell. Behaviour-neutral refactor of `review-grid.tsx` proves the hook matches the original.

**Tech Stack:** Next.js App Router client components, React hooks, Pointer Events, Tailwind, localStorage.

**Branch:** `feat/resizable-tables` (already created, stacked on `feat/boq-review-grid-excel` / PR #39; spec already committed here).

**No test harness:** these are client components with no unit suite. Per-task gate: `pnpm -C apps/web typecheck` + `eslint` on changed files. Behaviour gates are manual checks in the browser.

**Guardrails:** NEVER `git add -A`/`.` — untracked `apps/web/app/api/admin/{analytics,flags,logs}/` have type errors and must never be staged; stage only named files. A full typecheck may emit errors ONLY in `.next/types/validator.ts` referencing `app/api/admin/*` — pre-existing noise, treat typecheck as passing if that's the only thing. `react-hooks/exhaustive-deps` is NOT enabled — do not add eslint-disable comments for it. `noUncheckedIndexedAccess` is ON — guard indexed access.

---

## File Structure
- **Create** `apps/web/lib/use-column-resize.ts` — the reusable hook (no JSX).
- **Modify** `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx` — consume the hook (remove duplicated resize code).
- **Modify** `apps/web/components/shell/page-container.tsx` — add `'7xl'`.
- **Modify** `apps/web/app/(app)/boq/[boqId]/page.tsx` — width `6xl` → `7xl`.
- **Modify** `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` — fixed layout + hook + header handles + narrower Description + hover title.

---

### Task 1: Create `useColumnResize` hook

**Files:** Create `apps/web/lib/use-column-resize.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client';

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Reusable Excel-style column widths: drag to resize, double-click a handle to
 *  auto-fit, widths persisted per `storageKey` in localStorage. SSR-safe (all
 *  storage/DOM work happens in effects/handlers). */
export function useColumnResize(
  storageKey: string,
  defaults: number[],
  opts: { min?: number; max?: number } = {},
) {
  const min = opts.min ?? 48;
  const max = opts.max ?? 800;
  const [widths, setWidths] = useState<number[]>(defaults);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      // Right length AND every entry a finite number in range — a stale/junk
      // array must not wedge a table with NaN/zero-width columns.
      if (
        Array.isArray(saved) &&
        saved.length === defaults.length &&
        saved.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max)
      ) {
        setWidths(saved);
      }
    } catch {
      /* ignore malformed cache */
    }
    // deps: only re-hydrate when the storage key changes (exhaustive-deps is off in this project)
  }, [storageKey]);

  function persist(w: number[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(w));
    } catch {
      /* storage disabled/full — widths still apply this session */
    }
  }

  function startResize(i: number, e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[i] ?? defaults[i] ?? min;
    function move(ev: PointerEvent) {
      const next = Math.min(max, Math.max(min, startW + (ev.clientX - startX)));
      setWidths((prev) => {
        const out = [...prev];
        out[i] = next;
        return out;
      });
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidths((prev) => {
        persist(prev);
        return prev;
      });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function autoFit(i: number, texts: string[]) {
    const holder = autoFit as unknown as { _c?: HTMLCanvasElement };
    const canvas = holder._c || (holder._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    let m = min;
    for (const t of texts) m = Math.max(m, ctx.measureText(t).width + 28);
    const next = Math.min(max, Math.ceil(m));
    setWidths((prev) => {
      const out = [...prev];
      out[i] = next;
      persist(out);
      return out;
    });
  }

  const totalWidth = widths.reduce((a, b) => a + b, 0);
  return { widths, totalWidth, startResize, autoFit, setWidths };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm -C apps/web typecheck` — Expected: clean (per admin-noise rule).
Run: `pnpm -C apps/web exec eslint lib/use-column-resize.ts` — Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/use-column-resize.ts
git commit -m "feat(ui): reusable useColumnResize hook (drag/persist/auto-fit)"
```
Trailers:
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01D8UBPMHCjka4gQh8NjrA3L

---

### Task 2: Refactor `review-grid.tsx` to consume the hook (behaviour-neutral)

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx`

Current state (verified): the file declares `MIN_COL_W = 48`, `MAX_COL_W = 800`, a `const [colWidths, setColWidths] = useState(DEFAULT_COL_W)`, `totalWidth`, an `LS_KEY` + hydrate `useEffect`, a `persist` fn, `startColResize(i, e)`, and `autoFitCol(i)`. Header handles call `startColResize`/`autoFitCol`. The band effect and colgroup read `colWidths`/`totalWidth`.

- [ ] **Step 1: Import the hook**

Add near the top imports:
```tsx
import { useColumnResize } from '@/lib/use-column-resize';
```

- [ ] **Step 2: Replace the resize machinery with the hook**

Delete these from the component/file: the `const [colWidths, setColWidths] = useState(...)` line, the `const totalWidth = ...` line, the `LS_KEY` const, the localStorage hydrate `useEffect`, the `persist` function, the `startColResize` function, and the `autoFitCol` function. Also delete the now-unused module constants `MIN_COL_W` and `MAX_COL_W` (keep `DEFAULT_COL_W`, `MIN_ROW_H`, `MAX_ROW_H` — row resize still uses the last two).

Add, at the top of the component body (where `colWidths` used to be declared):
```tsx
const { widths: colWidths, totalWidth, startResize, autoFit } = useColumnResize(
  `boq-review-colw:${boqId}`,
  DEFAULT_COL_W,
  { min: 48, max: 800 },
);
```

- [ ] **Step 3: Point the header handles at the hook**

The 8 header handles currently read `onPointerDown={(e) => startColResize(N, e)}` and `onDoubleClick={() => autoFitCol(N)}`. Change to:
```tsx
onPointerDown={(e) => startResize(N, e)}
onDoubleClick={() => autoFit(N, rows.map((r) => colText(N, r)))}
```
Add a small helper in the component (or module) reproducing the old per-column pick used by `autoFitCol`:
```tsx
function colText(i: number, r: Row): string {
  return (
    [
      r.kind,
      r.itemNo,
      r.description,
      r.unit,
      r.qty ? String(r.qty) : '',
      r.rate ? String(r.rate) : '',
      r.amount ? String(r.amount) : '',
      '',
    ][i] || ''
  );
}
```
(`colText` for the Total column returns `''` — auto-fit there is a no-op floor, matching the old behaviour.)

- [ ] **Step 4: Confirm no other references broke**

The band effect (`colWidths.slice(...)`, `colWidths[active.col] ?? 0`), the `<colgroup>` map over `colWidths`, and `style={{ width: totalWidth }}` all keep working since `colWidths`/`totalWidth` are still in scope (now from the hook). `setColWidths` is no longer used anywhere — confirm it isn't referenced.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -C apps/web typecheck` — Expected: clean.
Run: `pnpm -C apps/web exec eslint "app/(app)/boq/[boqId]/import/review-grid.tsx"` — Expected: no output.

- [ ] **Step 6: Manual check** — importer review step: column resize, persistence (reload), and double-click auto-fit behave EXACTLY as before. Row resize, overlays, rail, navigator unaffected.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/import/review-grid.tsx"
git commit -m "refactor(boq): review grid consumes shared useColumnResize hook"
```
Trailers as above.

---

### Task 3: Add `7xl` width + widen the BOQ page

**Files:** Modify `apps/web/components/shell/page-container.tsx`, `apps/web/app/(app)/boq/[boqId]/page.tsx`

- [ ] **Step 1: Extend PageContainer**

In `page-container.tsx`, add `'7xl'` to the `Width` type and the `MAX` map:
```tsx
type Width = 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';
```
```tsx
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
```

- [ ] **Step 2: Use it on the BOQ page**

In `boq/[boqId]/page.tsx`, change `<PageContainer width="6xl">` to `<PageContainer width="7xl">`.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm -C apps/web typecheck` — Expected: clean.
Run: `pnpm -C apps/web exec eslint components/shell/page-container.tsx "app/(app)/boq/[boqId]/page.tsx"` — Expected: no output.

- [ ] **Step 4: Manual check** — the BOQ builder page is visibly wider (max-w-7xl ≈ 1280px).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shell/page-container.tsx "apps/web/app/(app)/boq/[boqId]/page.tsx"
git commit -m "feat(ui): add 7xl page width and apply it to the BOQ page"
```
Trailers as above.

---

### Task 4: BOQ builder — adjustable columns + hover-peek + narrower Description

**Files:** Modify `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx`

Current state (verified): `<div className="mt-4 max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border …">` wraps `<table className="w-full min-w-[720px] border-collapse text-sm">` with a static `<colgroup>` (8 `<col>`: w-16, flex, w-24, w-24, w-28, w-16, w-32, w-9), a sticky `<thead>` of 8 `<th>` (Item No, Description, Unit, Qty, Budget/Est, Days, Total, empty actions), and body rows including section/sub-section rows (colSpan) and item rows. The Description cell is an `<input defaultValue={it.description} …>` at ~line 289 with paddingLeft style. `boqId` is available in the component (it's a BOQ builder for one boq). `canEdit` gates editing.

- [ ] **Step 1: Import the hook + add defaults + wire it up**

Add import:
```tsx
import { useColumnResize } from '@/lib/use-column-resize';
```
Add a module constant near the top:
```tsx
// Item No, Description, Unit, Qty, Budget/Est, Days, Total, actions
const BUILDER_DEFAULT_W = [64, 320, 96, 96, 112, 64, 128, 36];
```
In the component body:
```tsx
const { widths, totalWidth, startResize, autoFit } = useColumnResize(
  `boq-builder-colw:${boqId}`,
  BUILDER_DEFAULT_W,
  { min: 40, max: 900 },
);
```

- [ ] **Step 2: Fixed layout + hook-driven colgroup**

Change the table tag:
```tsx
<table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: totalWidth }}>
```
(drop `w-full min-w-[720px]`). Replace the static `<colgroup>` with:
```tsx
<colgroup>
  {widths.map((w, i) => (
    <col key={i} style={{ width: w }} />
  ))}
</colgroup>
```

- [ ] **Step 3: Header resize handles on the 7 visible columns**

Each of the first 7 header `<th>` (indices 0..6 — Item No, Description, Unit, Qty, Budget/Est, Days, Total) gets `relative` added to its className and a handle appended as its last child. The 8th `<th>` (empty actions) gets no handle. For a column i:
```tsx
<div
  onPointerDown={(e) => startResize(i, e)}
  onDoubleClick={() => autoFit(i, builderColText(i))}
  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
/>
```
Add a helper that returns the visible cell strings per column across all items (used by auto-fit). `items` is the component's item array with `{ itemNo, description, uom, qty, rateCents, durationDays }`:
```tsx
function builderColText(i: number): string[] {
  switch (i) {
    case 0: return items.map((x) => x.itemNo ?? '');
    case 1: return items.map((x) => x.description);
    case 2: return items.map((x) => x.uom);
    case 3: return items.map((x) => String(x.qty || ''));
    case 4: return items.map((x) => String(x.rateCents ? x.rateCents / 100 : ''));
    case 5: return items.map((x) => String(x.durationDays ?? ''));
    default: return [];
  }
}
```
(Total column i=6 measures nothing meaningful → returns `[]`, auto-fit clamps to min; drag still resizes it. Adjust the field names to the ACTUAL `Item` type in the file — verify `itemNo`, `description`, `uom`, `qty`, `rateCents`, `durationDays` against the `type Item` declaration around line 34 before writing.)

- [ ] **Step 4: Narrower Description default + hover-peek**

The Description default width is already 320 in `BUILDER_DEFAULT_W[1]`. Add hover-peek to the Description `<input>` (~line 289): add the attribute
```tsx
title={it.description || undefined}
```
so a clipped description shows its full text on hover. Keep `defaultValue`, `onChange`, `onBlur`, `className`, and the `paddingLeft` style unchanged.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -C apps/web typecheck` — Expected: clean.
Run: `pnpm -C apps/web exec eslint "app/(app)/boq/[boqId]/boq-builder.tsx"` — Expected: no output.

- [ ] **Step 6: Manual check** — BOQ builder: Description is narrower by default; drag any header border → resizes; reload → persists (key `boq-builder-colw:<boqId>`); double-click a handle → auto-fits; hovering a clipped description shows full text; section/sub-section rows still render across the full width; sticky header intact; totals unchanged.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/boq/[boqId]/boq-builder.tsx"
git commit -m "feat(boq): adjustable columns + hover-peek + narrower description on builder"
```
Trailers as above.

---

## Final verification (after all tasks)
- [ ] Move untracked `app/api/admin/{analytics,flags,logs}/` aside, run `pnpm -C apps/web typecheck` + `pnpm -C apps/web build` (clean), restore them.
- [ ] Manual pass of the spec Testing checklist (importer unchanged; builder resizes/persists/auto-fits/hover-peek; page wider).
- [ ] Dispatch a final code-review subagent over the branch diff; then finish the branch.
