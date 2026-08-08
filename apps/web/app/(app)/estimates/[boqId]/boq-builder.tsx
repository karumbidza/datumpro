'use client';

import { useState, useTransition } from 'react';
import type { BoqDetail } from '@/lib/data/boq';
import {
  addSection,
  renameSection,
  deleteSection,
  addItem,
  updateItem,
  deleteItem,
  setBoqStatus,
} from '../actions';
import {
  BOQ_UNITS,
  BOQ_ITEM_TYPES,
  BOQ_ITEM_TYPE_LABELS,
  BOQ_ITEM_TYPE_SHORT,
  BOQ_STATUS_LABELS,
  type BoqItemType,
  type BoqStatus,
} from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';

type Item = { id: string; description: string; uom: string; qty: number; rateCents: number; itemType: BoqItemType };
type Section = { id: string; name: string; items: Item[] };

const STATUS_TONE: Record<BoqStatus, BadgeTone> = { draft: 'amber', approved: 'green', archived: 'faint' };

const cell =
  'w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none transition focus:ring-2 focus:ring-brand-500/25 disabled:cursor-default disabled:text-zinc-500';
const num = `${cell} text-right tabular-nums font-mono`;

export function BoqBuilder({ boq, canEdit }: { boq: BoqDetail; canEdit: boolean }) {
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
        itemType: it.itemType,
      })),
    })),
  );
  const [status, setStatus] = useState<BoqStatus>((boq.status as BoqStatus) ?? 'draft');
  const [lens, setLens] = useState<'budget' | 'tender'>('budget');
  const [pending, start] = useTransition();
  const cur = boq.currency;
  const tender = lens === 'tender';

  const itemTotal = (it: Item) => Math.round(it.qty * it.rateCents);
  const sectionTotal = (s: Section) => s.items.reduce((a, it) => a + itemTotal(it), 0);
  const grand = sections.reduce((a, s) => a + sectionTotal(s), 0);
  const itemCount = sections.reduce((a, s) => a + s.items.length, 0);

  // ── local-state helpers ─────────────────────────────────────────────────────
  const patchItem = (sectionId: string, itemId: string, up: (it: Item) => Item) =>
    setSections((prev) =>
      prev.map((s) => (s.id !== sectionId ? s : { ...s, items: s.items.map((it) => (it.id !== itemId ? it : up(it))) })),
    );

  // ── mutations (local state first, persisted via server actions) ─────────────
  const onAddSection = () =>
    start(async () => {
      const res = await addSection(boq.id);
      if ('id' in res) setSections((p) => [...p, { id: res.id, name: 'Untitled section', items: [] }]);
    });

  const onRenameSection = (id: string, name: string) => start(() => renameSection(boq.id, id, name).then(() => {}));

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
            s.id !== sectionId
              ? s
              : { ...s, items: [...s.items, { id: res.id, description: '', uom: '', qty: 0, rateCents: 0, itemType: 'measured' }] },
          ),
        );
    });

  const onDeleteItem = (sectionId: string, itemId: string) =>
    start(async () => {
      await deleteItem(boq.id, itemId);
      setSections((p) => p.map((s) => (s.id !== sectionId ? s : { ...s, items: s.items.filter((it) => it.id !== itemId) })));
    });

  const onApprove = () =>
    start(async () => {
      await setBoqStatus(boq.id, 'approved');
      setStatus('approved');
    });

  const meta = [boq.industry, boq.clientName, boq.reference, boq.boqDate].filter(Boolean).join(' · ');

  return (
    <div>
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
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(['budget', 'tender'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLens(l)}
                aria-pressed={lens === l}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  lens === l
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {l === 'budget' ? 'Estimate' : 'Tender view'}
              </button>
            ))}
          </div>
          {canEdit && status !== 'approved' && (
            <Button size="sm" onClick={onApprove} disabled={pending || itemCount === 0}>
              Approve BOQ
            </Button>
          )}
        </div>
      </div>

      {tender && (
        <p className="mt-3 rounded-lg border border-brand-500/40 bg-brand-50 px-3 py-2 text-sm text-zinc-700 dark:bg-brand-600/10 dark:text-zinc-200">
          <span className="font-semibold text-brand-600 dark:text-brand-500">Tender view</span> — the sealed sheet a
          contractor prices. Your estimate is hidden; the rate column is theirs.
        </p>
      )}

      {/* the bill */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-50 text-right text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="border-b border-zinc-300 px-3 py-2.5 text-left font-semibold dark:border-zinc-700">Section / item</th>
              <th className="border-b border-zinc-300 px-3 py-2.5 font-semibold dark:border-zinc-700">Unit</th>
              <th className="border-b border-zinc-300 px-3 py-2.5 font-semibold dark:border-zinc-700">Qty</th>
              <th className="border-b border-zinc-300 px-3 py-2.5 font-semibold dark:border-zinc-700">{tender ? 'Rate' : 'Est.'}</th>
              <th className="border-b border-zinc-300 px-3 py-2.5 text-left font-semibold dark:border-zinc-700">Type</th>
              <th className="border-b border-zinc-300 px-3 py-2.5 font-semibold dark:border-zinc-700">Total</th>
              <th className="w-8 border-b border-zinc-300 dark:border-zinc-700" />
            </tr>
          </thead>
          <tbody>
            {sections.map((s, si) => (
              <SectionRows
                key={s.id}
                index={si}
                section={s}
                canEdit={canEdit}
                tender={tender}
                currency={cur}
                itemTotal={itemTotal}
                sectionTotal={sectionTotal(s)}
                onRenameLocal={(name) => setSections((p) => p.map((x) => (x.id === s.id ? { ...x, name } : x)))}
                onRenamePersist={(name) => onRenameSection(s.id, name)}
                onDeleteSection={() => onDeleteSection(s.id)}
                onAddItem={() => onAddItem(s.id)}
                onDeleteItem={(itemId) => onDeleteItem(s.id, itemId)}
                onItemLocal={patchItem}
                persist={(itemId, p) => start(() => updateItem(boq.id, itemId, p).then(() => {}))}
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
            <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-900">
              <td className="px-3 py-3" colSpan={5}>
                Bill total
                <span className="ml-2 font-mono text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {itemCount} items · {sections.length} section{sections.length === 1 ? '' : 's'}
                </span>
              </td>
              <td className={`px-3 py-3 text-right tabular-nums text-brand-600 dark:text-brand-500 ${tender ? 'opacity-40' : ''}`}>
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
  tender,
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
  tender: boolean;
  currency: string;
  itemTotal: (it: Item) => number;
  sectionTotal: number;
  onRenameLocal: (name: string) => void;
  onRenamePersist: (name: string) => void;
  onDeleteSection: () => void;
  onAddItem: () => void;
  onDeleteItem: (itemId: string) => void;
  onItemLocal: (sectionId: string, itemId: string, up: (it: Item) => Item) => void;
  persist: (itemId: string, patch: { description?: string; uom?: string | null; qty?: number; budgetRateCents?: number; itemType?: BoqItemType }) => void;
}) {
  return (
    <>
      <tr className="bg-zinc-50/60 dark:bg-zinc-900/40">
        <td className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800" colSpan={5}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-400">{index + 1}</span>
            <input
              defaultValue={section.name}
              disabled={!canEdit}
              aria-label="Section name"
              onChange={(e) => onRenameLocal(e.target.value)}
              onBlur={(e) => onRenamePersist(e.target.value.trim() || 'Untitled section')}
              className="min-w-[180px] flex-1 rounded bg-transparent px-1.5 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-500/25 disabled:text-zinc-600"
            />
            <span className="font-mono text-xs text-zinc-400">
              {section.items.length} item{section.items.length === 1 ? '' : 's'}
            </span>
          </div>
        </td>
        <td className={`border-b border-zinc-200 px-3 py-2 text-right font-mono text-sm font-bold tabular-nums text-brand-600 dark:border-zinc-800 dark:text-brand-500 ${tender ? 'opacity-40' : ''}`}>
          {fmtMoney(sectionTotal, currency)}
        </td>
        <td className="border-b border-zinc-200 px-1 py-2 text-right dark:border-zinc-800">
          {canEdit && (
            <button
              type="button"
              onClick={onDeleteSection}
              aria-label="Delete section"
              className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            >
              ✕
            </button>
          )}
        </td>
      </tr>

      {section.items.map((it) => (
        <tr key={it.id} className="hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
          <td className="border-b border-zinc-100 py-1 pl-8 pr-3 dark:border-zinc-900">
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
          <td className="border-b border-zinc-100 py-1 dark:border-zinc-900">
            <select
              value={it.uom}
              disabled={!canEdit}
              aria-label="Unit"
              onChange={(e) => {
                const uom = e.target.value;
                onItemLocal(section.id, it.id, (x) => ({ ...x, uom }));
                persist(it.id, { uom: uom || null });
              }}
              className={`${cell} text-center`}
            >
              <option value="">—</option>
              {BOQ_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </td>
          <td className="border-b border-zinc-100 py-1 dark:border-zinc-900">
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
              className={num}
            />
          </td>
          <td className="border-b border-zinc-100 py-1 dark:border-zinc-900">
            <input
              defaultValue={it.rateCents ? (it.rateCents / 100).toFixed(2) : ''}
              disabled={!canEdit || tender}
              inputMode="decimal"
              placeholder={tender ? '—' : '0.00'}
              aria-label="Estimate rate"
              onBlur={(e) => {
                const rateCents = Math.round((Number(e.target.value) || 0) * 100);
                onItemLocal(section.id, it.id, (x) => ({ ...x, rateCents }));
                persist(it.id, { budgetRateCents: rateCents });
              }}
              className={`${num} ${tender ? 'opacity-40' : ''}`}
            />
          </td>
          <td className="border-b border-zinc-100 py-1 dark:border-zinc-900">
            <select
              value={it.itemType}
              disabled={!canEdit}
              aria-label="Item type"
              onChange={(e) => {
                const itemType = e.target.value as BoqItemType;
                onItemLocal(section.id, it.id, (x) => ({ ...x, itemType }));
                persist(it.id, { itemType });
              }}
              className={`${cell} text-xs`}
            >
              {BOQ_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BOQ_ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </td>
          <td className={`border-b border-zinc-100 px-3 py-1 text-right font-mono text-sm tabular-nums dark:border-zinc-900 ${tender ? 'text-zinc-400' : ''}`}>
            {BOQ_ITEM_TYPE_SHORT[it.itemType] && !tender && (
              <span className="mr-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                {BOQ_ITEM_TYPE_SHORT[it.itemType]}
              </span>
            )}
            {tender ? '—' : fmtMoney(itemTotal(it), currency)}
          </td>
          <td className="border-b border-zinc-100 px-1 py-1 text-right dark:border-zinc-900">
            {canEdit && (
              <button
                type="button"
                onClick={() => onDeleteItem(it.id)}
                aria-label="Delete item"
                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
              >
                ✕
              </button>
            )}
          </td>
        </tr>
      ))}

      {canEdit && (
        <tr>
          <td colSpan={7} className="border-b border-zinc-100 py-1.5 pl-8 dark:border-zinc-900">
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
