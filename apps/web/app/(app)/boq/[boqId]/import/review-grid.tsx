'use client';
import { useRef, useState } from 'react';
import { fmtMoney } from '@/lib/money';
import { type Row, type Kind, lineCents } from './grid-types';

const DEFAULT_COL_W = [96, 72, 360, 72, 88, 104, 120, 120]; // Kind No Desc Unit Qty Rate Amount Total

export function ReviewGrid({ rows, setRow, currency }: {
  rows: Row[];
  setRow: (i: number, patch: Partial<Row>) => void;
  currency: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colWidths] = useState<number[]>(DEFAULT_COL_W);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  return (
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
          <tr className="bg-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <th className="border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">Kind</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">No.</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">Description</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 dark:border-zinc-700">Unit</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">Qty</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">Rate</th>
            <th className="border-b border-r border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">Amount</th>
            <th className="border-b border-zinc-300 px-2 py-2 text-right dark:border-zinc-700">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isSection = r.kind === 'section';
            const isSkip = r.kind === 'skip';
            const measured = r.qty > 0 && r.rate > 0;
            const disabled = isSection || isSkip;
            return (
              <tr key={i} className={isSection ? 'bg-zinc-50 dark:bg-zinc-900/50' : isSkip ? 'opacity-45' : ''}>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <select
                    value={r.kind}
                    onChange={(e) => setRow(i, { kind: e.target.value as Kind })}
                    className={`w-full bg-transparent px-2 py-1.5 text-xs font-medium outline-none ${isSection ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500'}`}
                  >
                    <option value="section">Section</option>
                    <option value="item">Item</option>
                    <option value="skip">Skip</option>
                  </select>
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.itemNo}
                    disabled={disabled}
                    placeholder={isSection ? '' : '—'}
                    onChange={(e) => setRow(i, { itemNo: e.target.value })}
                    className="w-16 bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={r.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    className={`w-full bg-transparent px-2 py-1.5 outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 ${isSection ? 'font-semibold' : ''}`}
                  />
                </td>
                <td className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800">
                  <input
                    value={isSection ? '' : r.unit}
                    disabled={disabled}
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
  );
}
