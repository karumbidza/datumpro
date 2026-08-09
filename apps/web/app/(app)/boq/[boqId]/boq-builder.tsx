'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BoqDetail } from '@/lib/data/boq';
import {
  addSection,
  renameSection,
  deleteSection,
  addItem,
  updateItem,
  deleteItem,
  duplicateBoq,
} from '../actions';
import {
  BOQ_UNITS,
  BOQ_TYPE_LABELS,
  BOQ_STATUS_LABELS,
  isKnownUnit,
  type BoqStatus,
} from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';

type Item = { id: string; description: string; uom: string; qty: number; rateCents: number };
type Section = { id: string; name: string; items: Item[] };

const STATUS_TONE: Record<BoqStatus, BadgeTone> = { draft: 'amber', approved: 'green', archived: 'faint' };

// Shared cell recipe: borderless until focus, spreadsheet feel.
const cell =
  'w-full bg-transparent px-2.5 py-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-inset focus:ring-brand-500 dark:focus:bg-zinc-950';
const numCell = `${cell} text-right font-mono tabular-nums`;
const UOM_LIST = 'boq-uom-list';

export function BoqBuilder({ boq, canEdit }: { boq: BoqDetail; canEdit: boolean }) {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>(() =>
    boq.sections.map((s) => ({
      id: s.id,
      name: s.name,
      items: s.items.map((it) => ({
        id: it.id,
        description: it.description,
        uom: it.uom ?? '',
        qty: it.qty,
        rateCents: it.budgetRateCents,
      })),
    })),
  );
  const [pending, start] = useTransition();
  const cur = boq.currency;
  const status = (boq.status as BoqStatus) ?? 'draft';

  const itemTotal = (it: Item) => Math.round(it.qty * it.rateCents);
  const sectionTotal = (s: Section) => s.items.reduce((a, it) => a + itemTotal(it), 0);
  const grand = sections.reduce((a, s) => a + sectionTotal(s), 0);
  const itemCount = sections.reduce((a, s) => a + s.items.length, 0);

  const patchItem = (sectionId: string, itemId: string, up: (it: Item) => Item) =>
    setSections((prev) =>
      prev.map((s) => (s.id !== sectionId ? s : { ...s, items: s.items.map((it) => (it.id !== itemId ? it : up(it))) })),
    );
  const persist = (itemId: string, p: { description?: string; uom?: string | null; qty?: number; budgetRateCents?: number }) =>
    start(() => updateItem(boq.id, itemId, p).then(() => {}));

  const onAddSection = () =>
    start(async () => {
      const res = await addSection(boq.id);
      if ('id' in res) setSections((p) => [...p, { id: res.id, name: 'Untitled section', items: [] }]);
    });
  const onDeleteSection = (id: string) =>
    start(async () => {
      await deleteSection(boq.id, id);
      setSections((p) => p.filter((s) => s.id !== id));
    });
  const onAddItem = (sectionId: string) =>
    start(async () => {
      const res = await addItem(boq.id, sectionId);
      if ('id' in res)
        setSections((p) =>
          p.map((s) =>
            s.id !== sectionId ? s : { ...s, items: [...s.items, { id: res.id, description: '', uom: '', qty: 0, rateCents: 0 }] },
          ),
        );
    });
  const onDeleteItem = (sectionId: string, itemId: string) =>
    start(async () => {
      await deleteItem(boq.id, itemId);
      setSections((p) => p.map((s) => (s.id !== sectionId ? s : { ...s, items: s.items.filter((it) => it.id !== itemId) })));
    });
  const onDuplicate = () =>
    start(async () => {
      const res = await duplicateBoq(boq.id);
      if ('id' in res) router.push(`/boq/${res.id}`);
    });

  const meta = [BOQ_TYPE_LABELS[boq.boqType], boq.industry, boq.clientName, boq.reference, boq.boqDate]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <datalist id={UOM_LIST}>
        {BOQ_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {/* header */}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{boq.name}</h1>
            <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{BOQ_STATUS_LABELS[status] ?? status}</Badge>
          </div>
          {meta && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>}
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-xs text-zinc-400">Saving…</span>}
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={onDuplicate} disabled={pending}>
              Duplicate
            </Button>
          )}
        </div>
      </div>

      {/* the bill */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <colgroup>
            <col className="w-14" />
            <col />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-32" />
            <col className="w-9" />
          </colgroup>
          <thead>
            <tr className="bg-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">Item</th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">Description</th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">Unit</th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">Qty</th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">Est.</th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">Total</th>
              <th className="border-b border-zinc-300 dark:border-zinc-700" />
            </tr>
          </thead>
          <tbody>
            {sections.map((s, si) => (
              <SectionRows
                key={s.id}
                index={si}
                section={s}
                canEdit={canEdit}
                currency={cur}
                itemTotal={itemTotal}
                sectionTotal={sectionTotal(s)}
                onRenameLocal={(name) => setSections((p) => p.map((x) => (x.id === s.id ? { ...x, name } : x)))}
                onRenamePersist={(name) => start(() => renameSection(boq.id, s.id, name).then(() => {}))}
                onDeleteSection={() => onDeleteSection(s.id)}
                onAddItem={() => onAddItem(s.id)}
                onDeleteItem={(itemId) => onDeleteItem(s.id, itemId)}
                onItemLocal={patchItem}
                persist={persist}
              />
            ))}
            {sections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Blank bill. Add a section — like <b>Preliminaries</b> or <b>Earthworks</b> — then add priced items.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
              <td className="px-2.5 py-3" colSpan={5}>
                Bill total
                <span className="ml-2 font-mono text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {itemCount} items · {sections.length} section{sections.length === 1 ? '' : 's'}
                </span>
              </td>
              <td className="border-l border-zinc-300 px-2.5 py-3 text-right tabular-nums text-brand-600 dark:border-zinc-700 dark:text-brand-500">
                {fmtMoney(grand, cur)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onAddSection}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 disabled:opacity-50 dark:border-zinc-700"
          >
            + Add section
          </button>
        </div>
      )}
    </div>
  );
}

function SectionRows({
  index,
  section,
  canEdit,
  currency,
  itemTotal,
  sectionTotal,
  onRenameLocal,
  onRenamePersist,
  onDeleteSection,
  onAddItem,
  onDeleteItem,
  onItemLocal,
  persist,
}: {
  index: number;
  section: Section;
  canEdit: boolean;
  currency: string;
  itemTotal: (it: Item) => number;
  sectionTotal: number;
  onRenameLocal: (name: string) => void;
  onRenamePersist: (name: string) => void;
  onDeleteSection: () => void;
  onAddItem: () => void;
  onDeleteItem: (itemId: string) => void;
  onItemLocal: (sectionId: string, itemId: string, up: (it: Item) => Item) => void;
  persist: (itemId: string, patch: { description?: string; uom?: string | null; qty?: number; budgetRateCents?: number }) => void;
}) {
  const rowBorder = 'border-b border-zinc-200 dark:border-zinc-800';
  const colBorder = 'border-r border-zinc-200 dark:border-zinc-800';

  return (
    <>
      {/* section header */}
      <tr className="bg-zinc-50 dark:bg-zinc-900/50">
        <td className={`${rowBorder} ${colBorder} px-2.5 py-2 text-center font-mono text-xs font-bold text-zinc-500`}>{index + 1}</td>
        <td className={`${rowBorder} ${colBorder} px-2.5 py-1.5`} colSpan={4}>
          <div className="flex items-center gap-2">
            <input
              defaultValue={section.name}
              disabled={!canEdit}
              aria-label="Section name"
              onChange={(e) => onRenameLocal(e.target.value)}
              onBlur={(e) => onRenamePersist(e.target.value.trim() || 'Untitled section')}
              className="min-w-[160px] flex-1 rounded bg-transparent px-1 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-brand-500 disabled:text-zinc-700 dark:disabled:text-zinc-300"
            />
            <span className="font-mono text-xs text-zinc-400">
              {section.items.length} item{section.items.length === 1 ? '' : 's'}
            </span>
          </div>
        </td>
        <td className={`${rowBorder} px-2.5 py-2 text-right font-mono text-sm font-bold tabular-nums text-brand-600 dark:text-brand-500`}>
          {fmtMoney(sectionTotal, currency)}
        </td>
        <td className={`${rowBorder} px-1 text-center`}>
          {canEdit && (
            <button type="button" onClick={onDeleteSection} aria-label="Delete section" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
              ✕
            </button>
          )}
        </td>
      </tr>

      {/* items */}
      {section.items.map((it, ii) => {
        const badUnit = !isKnownUnit(it.uom);
        return (
          <tr key={it.id} className="group hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
            <td className={`${rowBorder} ${colBorder} px-2.5 py-2 text-center font-mono text-xs text-zinc-400`}>
              {index + 1}.{ii + 1}
            </td>
            <td className={`${rowBorder} ${colBorder} p-0`}>
              <input
                defaultValue={it.description}
                disabled={!canEdit}
                placeholder="Item description"
                aria-label="Description"
                onChange={(e) => onItemLocal(section.id, it.id, (x) => ({ ...x, description: e.target.value }))}
                onBlur={(e) => persist(it.id, { description: e.target.value })}
                className={cell}
              />
            </td>
            <td className={`${rowBorder} ${colBorder} p-0`}>
              <input
                defaultValue={it.uom}
                disabled={!canEdit}
                list={UOM_LIST}
                placeholder="unit"
                aria-label="Unit"
                title={badUnit ? 'Unrecognised unit — allowed, but check it' : undefined}
                onChange={(e) => onItemLocal(section.id, it.id, (x) => ({ ...x, uom: e.target.value }))}
                onBlur={(e) => persist(it.id, { uom: e.target.value })}
                className={`${cell} text-center ${badUnit ? 'text-red-600 dark:text-red-400' : ''}`}
              />
            </td>
            <td className={`${rowBorder} ${colBorder} p-0`}>
              <input
                defaultValue={it.qty ? String(it.qty) : ''}
                disabled={!canEdit}
                inputMode="decimal"
                placeholder="0"
                aria-label="Quantity"
                onBlur={(e) => {
                  const qty = Math.max(0, Number(e.target.value) || 0);
                  onItemLocal(section.id, it.id, (x) => ({ ...x, qty }));
                  persist(it.id, { qty });
                }}
                className={numCell}
              />
            </td>
            <td className={`${rowBorder} ${colBorder} p-0`}>
              <input
                defaultValue={it.rateCents ? (it.rateCents / 100).toFixed(2) : ''}
                disabled={!canEdit}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Estimate rate"
                onBlur={(e) => {
                  const rateCents = Math.round((Number(e.target.value) || 0) * 100);
                  onItemLocal(section.id, it.id, (x) => ({ ...x, rateCents }));
                  persist(it.id, { budgetRateCents: rateCents });
                }}
                className={numCell}
              />
            </td>
            <td className={`${rowBorder} px-2.5 py-2 text-right font-mono text-sm tabular-nums`}>{fmtMoney(itemTotal(it), currency)}</td>
            <td className={`${rowBorder} px-1 text-center`}>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDeleteItem(it.id)}
                  aria-label="Delete item"
                  className="rounded p-1 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  ✕
                </button>
              )}
            </td>
          </tr>
        );
      })}

      {/* add item — a row inside the table */}
      {canEdit && (
        <tr>
          <td className={`${rowBorder} ${colBorder}`} />
          <td className={`${rowBorder} px-2.5 py-1.5`} colSpan={6}>
            <button
              type="button"
              onClick={onAddItem}
              className="inline-flex items-center gap-1.5 rounded border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700"
            >
              + Add item
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
