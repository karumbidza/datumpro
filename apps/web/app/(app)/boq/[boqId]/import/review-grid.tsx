'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtMoney } from '@/lib/money';
import { inputCompactClass } from '@/components/ui/form';
import { useColumnResize } from '@/lib/use-column-resize';
import { type Row, type Kind, lineCents } from './grid-types';

const DEFAULT_COL_W = [96, 72, 360, 72, 88, 104, 120, 120]; // Kind No Desc Unit Qty Rate Amount Total
const MIN_ROW_H = 28;
const MAX_ROW_H = 400;

function colText(i: number, r: Row): string {
  return (
    [r.kind, r.itemNo, r.description, r.unit, r.qty ? String(r.qty) : '', r.rate ? String(r.rate) : '', r.amount ? String(r.amount) : '', ''][i] || ''
  );
}

export function ReviewGrid({ boqId, rows, setRow, currency }: {
  boqId: string;
  rows: Row[];
  setRow: (i: number, patch: Partial<Row>) => void;
  currency: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { widths: colWidths, totalWidth, startResize, autoFit } = useColumnResize(
    `boq-review-colw:${boqId}`,
    DEFAULT_COL_W,
    { min: 48, max: 800 },
  );
  const [rowHeights, setRowHeights] = useState<Map<number, number>>(new Map());
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [band, setBand] = useState<{ rowTop: number; rowH: number; colLeft: number; colW: number } | null>(null);

  const [metrics, setMetrics] = useState({ scrollTop: 0, scrollH: 0, clientH: 0 });
  function syncMetrics() {
    const b = scrollRef.current;
    if (b) setMetrics({ scrollTop: b.scrollTop, scrollH: b.scrollHeight, clientH: b.clientHeight });
  }
  useEffect(() => {
    syncMetrics();
  }, [rows.length, colWidths, rowHeights]);

  const [dragging, setDragging] = useState(false);
  const trackH = metrics.clientH;
  const thumbH = metrics.scrollH > 0 ? Math.max(28, (metrics.clientH / metrics.scrollH) * trackH) : 0;
  const thumbTop =
    metrics.scrollH > metrics.clientH
      ? (metrics.scrollTop / (metrics.scrollH - metrics.clientH)) * (trackH - thumbH)
      : 0;
  const showRail = metrics.scrollH > metrics.clientH + 4;
  const firstVisible = (() => {
    const tbody = tableRef.current?.tBodies[0];
    if (!tbody) return 0;
    for (let k = 0; k < tbody.children.length; k++) {
      const el = tbody.children[k] as HTMLElement | undefined;
      if (el && el.offsetTop >= metrics.scrollTop) return k + 1;
    }
    return rows.length;
  })();

  function startRailDrag(e: React.PointerEvent) {
    e.preventDefault();
    setDragging(true);
    const startY = e.clientY;
    const startScroll = metrics.scrollTop;
    const box = scrollRef.current;
    const denom = trackH - thumbH || 1;
    if (!box) return;
    function move(ev: PointerEvent) {
      const frac = (ev.clientY - startY) / denom;
      box!.scrollTop = startScroll + frac * (metrics.scrollH - metrics.clientH);
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

  const sections = useMemo(
    () => rows.map((r, i) => ({ i, label: r.description, kind: r.kind })).filter((s) => s.kind === 'section'),
    [rows],
  );
  const [navQuery, setNavQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const filtered = navQuery
    ? sections.filter((s) => s.label.toLowerCase().includes(navQuery.toLowerCase()))
    : sections;

  function jumpTo(rowIndex: number) {
    const box = scrollRef.current;
    const table = tableRef.current;
    const tr = table?.tBodies[0]?.children[rowIndex] as HTMLElement | undefined;
    const thead = table?.tHead ?? undefined;
    if (!box || !tr) return;
    box.scrollTop = tr.offsetTop - (thead?.offsetHeight ?? 0);
    setNavOpen(false);
    setNavQuery('');
  }

  useEffect(() => {
    const table = tableRef.current;
    if (!active || !table) {
      setBand(null);
      return;
    }
    const tbody = table.tBodies[0];
    const tr = tbody?.children[active.row] as HTMLElement | undefined;
    if (!tr) {
      setBand(null);
      return;
    }
    const colLeft = colWidths.slice(0, active.col).reduce((a, b) => a + b, 0);
    const colW = colWidths[active.col] ?? 0;
    setBand({ rowTop: tr.offsetTop, rowH: tr.offsetHeight, colLeft, colW });
  }, [active, colWidths, rowHeights, rows.length]);

  function startRowResize(i: number, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const tr = (e.currentTarget as HTMLElement).closest('tr');
    const startH = tr?.offsetHeight ?? MIN_ROW_H;
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
  return (
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

      <div className="relative">
      <div
        ref={scrollRef}
        onScroll={syncMetrics}
        onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setActive(null);
      }}
      className="relative max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-zinc-300 dark:border-zinc-700"
    >
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
      <table ref={tableRef} className="relative z-10 border-collapse text-sm" style={{ tableLayout: 'fixed', width: totalWidth }}>
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20">
          <tr className="bg-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">
              Kind
              <div
                onPointerDown={(e) => startResize(0, e)}
                onDoubleClick={() => autoFit(0, rows.map((r) => colText(0, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">
              No.
              <div
                onPointerDown={(e) => startResize(1, e)}
                onDoubleClick={() => autoFit(1, rows.map((r) => colText(1, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">
              Description
              <div
                onPointerDown={(e) => startResize(2, e)}
                onDoubleClick={() => autoFit(2, rows.map((r) => colText(2, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">
              Unit
              <div
                onPointerDown={(e) => startResize(3, e)}
                onDoubleClick={() => autoFit(3, rows.map((r) => colText(3, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">
              Qty
              <div
                onPointerDown={(e) => startResize(4, e)}
                onDoubleClick={() => autoFit(4, rows.map((r) => colText(4, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">
              Rate
              <div
                onPointerDown={(e) => startResize(5, e)}
                onDoubleClick={() => autoFit(5, rows.map((r) => colText(5, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">
              Amount
              <div
                onPointerDown={(e) => startResize(6, e)}
                onDoubleClick={() => autoFit(6, rows.map((r) => colText(6, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
            <th className="relative border-b border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">
              Total
              <div
                onPointerDown={(e) => startResize(7, e)}
                onDoubleClick={() => autoFit(7, rows.map((r) => colText(7, r)))}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/50"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isSection = r.kind === 'section';
            const isSkip = r.kind === 'skip';
            const measured = r.qty > 0 && r.rate > 0;
            const disabled = isSection || isSkip;
            return (
              <tr
                key={i}
                style={{ height: rowHeights.get(i) }}
                className={isSection ? 'bg-zinc-50 dark:bg-zinc-900/50' : isSkip ? 'opacity-45' : ''}
              >
                <td className="relative border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <select
                    value={r.kind}
                    onFocus={() => setActive({ row: i, col: 0 })}
                    onChange={(e) => setRow(i, { kind: e.target.value as Kind })}
                    className={`w-full bg-transparent px-2 py-1.5 text-xs font-medium outline-none ${isSection ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500'}`}
                  >
                    <option value="section">Section</option>
                    <option value="item">Item</option>
                    <option value="skip">Skip</option>
                  </select>
                  <div
                    onPointerDown={(e) => startRowResize(i, e)}
                    onDoubleClick={() => resetRow(i)}
                    className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-row-resize touch-none select-none hover:bg-brand-400/50"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.itemNo}
                    disabled={disabled}
                    placeholder={isSection ? '' : '—'}
                    onFocus={() => setActive({ row: i, col: 1 })}
                    onChange={(e) => setRow(i, { itemNo: e.target.value })}
                    className="w-16 bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <textarea
                    value={r.description}
                    onFocus={() => setActive({ row: i, col: 2 })}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    rows={1}
                    className={`h-full w-full resize-none bg-transparent px-2 py-1.5 leading-snug outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 ${isSection ? 'font-semibold' : ''}`}
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.unit}
                    disabled={disabled}
                    onFocus={() => setActive({ row: i, col: 3 })}
                    onChange={(e) => setRow(i, { unit: e.target.value })}
                    className="w-full bg-transparent px-2 py-1.5 text-center outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 disabled:bg-transparent"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.qty ? String(r.qty) : ''}
                    disabled={disabled}
                    inputMode="decimal"
                    placeholder={isSection ? '' : '—'}
                    onFocus={() => setActive({ row: i, col: 4 })}
                    onChange={(e) => setRow(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full bg-transparent px-2 py-1.5 text-right font-mono tabular-nums outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.rate ? String(r.rate) : ''}
                    disabled={disabled}
                    inputMode="decimal"
                    placeholder={isSection ? '' : '—'}
                    onFocus={() => setActive({ row: i, col: 5 })}
                    onChange={(e) => setRow(i, { rate: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full bg-transparent px-2 py-1.5 text-right font-mono tabular-nums outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.amount ? String(r.amount) : ''}
                    disabled={disabled}
                    inputMode="decimal"
                    placeholder={isSection ? '' : '—'}
                    onFocus={() => setActive({ row: i, col: 6 })}
                    onChange={(e) => setRow(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
                    className={`w-full bg-transparent px-2 py-1.5 text-right font-mono tabular-nums outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 ${measured ? 'text-zinc-400' : ''}`}
                  />
                </td>
                <td className="border-b border-zinc-200 px-2 py-1.5 text-right font-mono tabular-nums dark:border-zinc-800">
                  {disabled ? '' : fmtMoney(lineCents(r), currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    </div>
  );
}
