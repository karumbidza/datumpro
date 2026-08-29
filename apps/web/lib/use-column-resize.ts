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
    // Intentionally re-hydrate only when the storage key changes — min/max/defaults
    // are stable per table, and re-running on them would clobber user-set widths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
