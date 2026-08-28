'use client';

import { useState, useTransition, type DragEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { BoqDetail } from '@/lib/data/boq';
import {
  addSection,
  renameSection,
  deleteSection,
  addItem,
  updateItem,
  deleteItem,
  moveItem,
  duplicateBoq,
  addSectionDep,
  removeSectionDep,
} from '../actions';
import {
  BOQ_UNITS,
  BOQ_TYPE_LABELS,
  BOQ_STATUS_LABELS,
  TENDER_STATUS_LABELS,
  isKnownUnit,
  type BoqStatus,
  type TenderStatus,
} from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BOQ_STATUS_TONE, TENDER_STATUS_TONE } from '@/components/ui/tones';

type Item = { id: string; sectionId: string; itemNo: string | null; description: string; uom: string; qty: number; rateCents: number; durationDays: number | null };
type Section = { id: string; name: string; parentId: string | null };
type Dep = { sectionId: string; dependsOnId: string };

const TENDER_BADGE: Partial<Record<TenderStatus, string>> = {
  open: 'Out to tender',
  closed: 'Tender closed',
  awarded: 'Awarded',
};
const UOM_LIST = 'boq-uom-list';

const rowB = 'border-b border-zinc-200 dark:border-zinc-800';
const colB = 'border-r border-zinc-200 dark:border-zinc-800';
const cell =
  'w-full bg-transparent px-2.5 py-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-inset focus:ring-brand-500 dark:focus:bg-zinc-950';
const numCell = `${cell} text-right font-mono tabular-nums`;

export function BoqBuilder({
  boq,
  canEdit,
  projectTasksGenerated = false,
}: {
  boq: BoqDetail;
  canEdit: boolean;
  projectTasksGenerated?: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>(() =>
    boq.sections.map((s) => ({ id: s.id, name: s.name, parentId: s.parentId })),
  );
  const [items, setItems] = useState<Item[]>(() =>
    boq.items.map((it) => ({
      id: it.id,
      sectionId: it.sectionId,
      itemNo: it.itemNo,
      description: it.description,
      uom: it.uom ?? '',
      qty: it.qty,
      rateCents: it.budgetRateCents,
      durationDays: it.durationDays,
    })),
  );
  const [deps, setDeps] = useState<Dep[]>(() => boq.deps.map((d) => ({ sectionId: d.sectionId, dependsOnId: d.dependsOnId })));
  const [depError, setDepError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = boq.currency;
  const status = (boq.status as BoqStatus) ?? 'draft';

  const childSections = (pid: string | null) => sections.filter((s) => s.parentId === pid);
  const itemsOf = (sid: string) => items.filter((i) => i.sectionId === sid);
  const itemTotal = (it: Item) => Math.round(it.qty * it.rateCents);
  const sectionTotal = (sid: string): number =>
    itemsOf(sid).reduce((a, it) => a + itemTotal(it), 0) + childSections(sid).reduce((a, c) => a + sectionTotal(c.id), 0);
  const grand = items.reduce((a, it) => a + itemTotal(it), 0);
  const sectionDays = (sid: string): number =>
    itemsOf(sid).reduce((a, it) => a + (it.durationDays ?? 0), 0) +
    childSections(sid).reduce((a, c) => a + sectionDays(c.id), 0);

  const onAddDep = (sectionId: string, dependsOnId: string) => {
    if (!dependsOnId) return;
    setDepError(null);
    start(async () => {
      const res = await addSectionDep(boq.id, sectionId, dependsOnId);
      if (res && 'error' in res) setDepError(res.error);
      else setDeps((p) => [...p, { sectionId, dependsOnId }]);
    });
  };
  const onRemoveDep = (sectionId: string, dependsOnId: string) =>
    start(async () => {
      await removeSectionDep(boq.id, sectionId, dependsOnId);
      setDeps((p) => p.filter((d) => !(d.sectionId === sectionId && d.dependsOnId === dependsOnId)));
    });

  // ── mutations (local state first, persisted via server actions) ─────────────
  const persistItem = (id: string, p: { description?: string; uom?: string | null; qty?: number; budgetRateCents?: number; durationDays?: number | null }) =>
    start(() => updateItem(boq.id, id, p).then(() => {}));
  const patchLocal = (id: string, up: (it: Item) => Item) => setItems((prev) => prev.map((it) => (it.id === id ? up(it) : it)));

  const onAddSection = (parentId: string | null) =>
    start(async () => {
      const res = await addSection(boq.id, parentId);
      if ('id' in res) setSections((p) => [...p, { id: res.id, name: parentId ? 'Untitled sub-section' : 'Untitled section', parentId }]);
    });
  const onAddItem = (sectionId: string) =>
    start(async () => {
      const res = await addItem(boq.id, sectionId);
      if ('id' in res) setItems((p) => [...p, { id: res.id, sectionId, itemNo: null, description: '', uom: '', qty: 0, rateCents: 0, durationDays: null }]);
    });
  const onDeleteItem = (id: string) =>
    start(async () => {
      await deleteItem(boq.id, id);
      setItems((p) => p.filter((i) => i.id !== id));
    });
  const onDeleteSection = (id: string) =>
    start(async () => {
      await deleteSection(boq.id, id);
      const dead = new Set<string>();
      const collect = (sid: string) => {
        dead.add(sid);
        sections.filter((s) => s.parentId === sid).forEach((c) => collect(c.id));
      };
      collect(id);
      setSections((p) => p.filter((s) => !dead.has(s.id)));
      setItems((p) => p.filter((i) => !dead.has(i.sectionId)));
    });
  const onDuplicate = () =>
    start(async () => {
      const res = await duplicateBoq(boq.id);
      if ('id' in res) router.push(`/boq/${res.id}`);
    });

  // ── drag an item into another section ───────────────────────────────────────
  const onMoveItem = (itemId: string, targetSectionId: string) => {
    setItems((prev) => {
      const it = prev.find((x) => x.id === itemId);
      if (!it || it.sectionId === targetSectionId) return prev;
      return [...prev.filter((x) => x.id !== itemId), { ...it, sectionId: targetSectionId }];
    });
    start(() => moveItem(boq.id, itemId, targetSectionId).then(() => {}));
  };
  const onDropInto = (e: DragEvent, targetSectionId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/item');
    if (id) onMoveItem(id, targetSectionId);
  };
  const allowDrop = canEdit ? (e: DragEvent) => e.preventDefault() : undefined;

  const meta = [BOQ_TYPE_LABELS[boq.boqType], boq.industry, boq.clientName, boq.reference, boq.boqDate].filter(Boolean).join(' · ');

  // ── recursive render → an array of <tr> ─────────────────────────────────────
  function renderSection(s: Section, depth: number, number: string): ReactElement[] {
    const my = itemsOf(s.id);
    const kids = childSections(s.id);
    const out: ReactElement[] = [];

    out.push(
      <tr key={`s-${s.id}`} className="bg-zinc-50 dark:bg-zinc-900/50" onDragOver={allowDrop} onDrop={canEdit ? (e) => onDropInto(e, s.id) : undefined}>
        <td className={`${rowB} ${colB} px-2.5 py-2 text-center font-mono text-xs font-bold text-zinc-500`}>{number}</td>
        <td className={`${rowB} ${colB} py-1.5 pr-2`} colSpan={5}>
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
            <input
              defaultValue={s.name}
              disabled={!canEdit}
              aria-label="Section name"
              onChange={(e) => setSections((p) => p.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
              onBlur={(e) => start(() => renameSection(boq.id, s.id, e.target.value.trim() || 'Untitled section').then(() => {}))}
              className="min-w-[150px] flex-1 rounded bg-transparent px-1 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-brand-500 disabled:text-zinc-700 dark:disabled:text-zinc-300"
            />
            {sectionDays(s.id) > 0 && (
              <span className="whitespace-nowrap font-mono text-xs text-zinc-400">~{sectionDays(s.id)}d</span>
            )}
            <span className="whitespace-nowrap font-mono text-xs text-zinc-400">
              {my.length + kids.length} entr{my.length + kids.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          {/* Programme links: "this section starts after …" chips + picker. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5" style={{ paddingLeft: depth * 18 + 4 }}>
            {deps
              .filter((d) => d.sectionId === s.id)
              .map((d) => (
                <span
                  key={d.dependsOnId}
                  className="inline-flex items-center gap-1 rounded bg-zinc-200/70 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  after {sections.find((x) => x.id === d.dependsOnId)?.name ?? 'section'}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label="Remove link"
                      onClick={() => onRemoveDep(s.id, d.dependsOnId)}
                      className="rounded px-0.5 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            {canEdit && sections.length > 1 && (
              <select
                value=""
                aria-label="Starts after section"
                onChange={(e) => onAddDep(s.id, e.target.value)}
                className="rounded border border-dashed border-zinc-300 bg-transparent px-1 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700"
              >
                <option value="">+ starts after…</option>
                {sections
                  .filter((x) => x.id !== s.id && !deps.some((d) => d.sectionId === s.id && d.dependsOnId === x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </td>
        <td className={`${rowB} px-2.5 py-2 text-right font-mono text-sm font-bold tabular-nums text-brand-600 dark:text-brand-500`}>
          {fmtMoney(sectionTotal(s.id), cur)}
        </td>
        <td className={`${rowB} px-1 text-center`}>
          {canEdit && (
            <button type="button" onClick={() => onDeleteSection(s.id)} aria-label="Delete section" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
              ✕
            </button>
          )}
        </td>
      </tr>,
    );

    my.forEach((it, j) => {
      const badUnit = !isKnownUnit(it.uom);
      out.push(
        <tr key={`i-${it.id}`} className="group hover:bg-brand-50/40 dark:hover:bg-brand-600/5" onDragOver={allowDrop} onDrop={canEdit ? (e) => onDropInto(e, s.id) : undefined}>
          <td
            className={`${rowB} ${colB} px-2.5 py-2 text-center font-mono text-xs text-zinc-400 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''}`}
            draggable={canEdit}
            onDragStart={
              canEdit
                ? (e) => {
                    e.dataTransfer.setData('text/item', it.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }
                : undefined
            }
            title={canEdit ? 'Drag to move to another section' : undefined}
          >
            {it.itemNo ? it.itemNo : `${number}.${j + 1}`}
          </td>
          <td className={`${rowB} ${colB} p-0`}>
            <input
              defaultValue={it.description}
              disabled={!canEdit}
              placeholder="Item description"
              aria-label="Description"
              style={{ paddingLeft: (depth + 1) * 18 + 10 }}
              onChange={(e) => patchLocal(it.id, (x) => ({ ...x, description: e.target.value }))}
              onBlur={(e) => persistItem(it.id, { description: e.target.value })}
              className={cell}
            />
          </td>
          <td className={`${rowB} ${colB} p-0`}>
            <input
              defaultValue={it.uom}
              disabled={!canEdit}
              list={UOM_LIST}
              placeholder="unit"
              aria-label="Unit"
              title={badUnit ? 'Unrecognised unit — allowed, but check it' : undefined}
              onChange={(e) => patchLocal(it.id, (x) => ({ ...x, uom: e.target.value }))}
              onBlur={(e) => persistItem(it.id, { uom: e.target.value })}
              className={`${cell} text-center ${badUnit ? 'text-red-600 dark:text-red-400' : ''}`}
            />
          </td>
          <td className={`${rowB} ${colB} p-0`}>
            <input
              defaultValue={it.qty ? String(it.qty) : ''}
              disabled={!canEdit}
              inputMode="decimal"
              placeholder="0"
              aria-label="Quantity"
              onBlur={(e) => {
                const qty = Math.max(0, Number(e.target.value) || 0);
                patchLocal(it.id, (x) => ({ ...x, qty }));
                persistItem(it.id, { qty });
              }}
              className={numCell}
            />
          </td>
          <td className={`${rowB} ${colB} p-0`}>
            <input
              defaultValue={it.rateCents ? (it.rateCents / 100).toFixed(2) : ''}
              disabled={!canEdit}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Estimate rate"
              onBlur={(e) => {
                const rateCents = Math.round((Number(e.target.value) || 0) * 100);
                patchLocal(it.id, (x) => ({ ...x, rateCents }));
                persistItem(it.id, { budgetRateCents: rateCents });
              }}
              className={numCell}
            />
          </td>
          <td className={`${rowB} ${colB} p-0`}>
            <input
              defaultValue={it.durationDays != null ? String(it.durationDays) : ''}
              disabled={!canEdit}
              inputMode="numeric"
              placeholder="—"
              aria-label="Duration in working days"
              title="Working days"
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const durationDays = raw === '' ? null : Math.max(0, Math.round(Number(raw) || 0));
                patchLocal(it.id, (x) => ({ ...x, durationDays }));
                persistItem(it.id, { durationDays });
              }}
              className={numCell}
            />
          </td>
          <td className={`${rowB} px-2.5 py-2 text-right font-mono text-sm tabular-nums`}>{fmtMoney(itemTotal(it), cur)}</td>
          <td className={`${rowB} px-1 text-center`}>
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
        </tr>,
      );
    });

    if (canEdit) {
      out.push(
        <tr key={`add-${s.id}`}>
          <td className={`${rowB} ${colB}`} />
          <td className={`${rowB} py-1.5`} colSpan={7}>
            <div className="flex gap-2" style={{ paddingLeft: (depth + 1) * 18 + 10 }}>
              <button type="button" onClick={() => onAddItem(s.id)} className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700">
                + Add item
              </button>
              <button type="button" onClick={() => onAddSection(s.id)} className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700">
                + Add sub-section
              </button>
            </div>
          </td>
        </tr>,
      );
    }

    kids.forEach((c, m) => {
      out.push(...renderSection(c, depth + 1, `${number}.${my.length + m + 1}`));
    });
    return out;
  }

  const topSections = childSections(null);
  const bodyRows = topSections.flatMap((s, i) => renderSection(s, 0, String(i + 1)));

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
            <Badge tone={BOQ_STATUS_TONE[status] ?? 'neutral'}>{BOQ_STATUS_LABELS[status] ?? status}</Badge>
            {boq.tenderStatus && (
              <Badge tone={TENDER_STATUS_TONE[boq.tenderStatus] ?? 'neutral'}>
                {TENDER_BADGE[boq.tenderStatus] ?? TENDER_STATUS_LABELS[boq.tenderStatus]}
              </Badge>
            )}
          </div>
          {meta && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>}
          {boq.projectId && (
            <Link
              href={`/projects/${boq.projectId}/boq`}
              className="mt-0.5 inline-block text-xs text-brand-600 hover:underline dark:text-brand-500"
            >
              Project: {boq.projectName ?? 'view project'} →
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-xs text-zinc-400">Saving…</span>}
          {canEdit && (
            <Link href={`/boq/${boq.id}/tender`}>
              <Button variant="secondary" size="sm">
                Put out to tender
              </Button>
            </Link>
          )}
          {canEdit && (
            <Link href={`/boq/${boq.id}/import`}>
              <Button variant="secondary" size="sm">
                Import Excel
              </Button>
            </Link>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={onDuplicate} disabled={pending}>
              Duplicate
            </Button>
          )}
        </div>
      </div>

      {/* Linked + approved + tasks not yet generated → point at the one place
          that generates them (the project BOQ tab). */}
      {boq.projectId && status === 'approved' && !projectTasksGenerated && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/30">
          <p className="text-sm text-brand-700 dark:text-brand-400">
            Bill approved — generate this project&apos;s tasks from it.
          </p>
          <Link
            href={`/projects/${boq.projectId}/boq`}
            className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-500"
          >
            Generate tasks →
          </Link>
        </div>
      )}

      {depError && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {depError}
        </p>
      )}

      {/* the bill */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-16" />
            <col className="w-32" />
            <col className="w-9" />
          </colgroup>
          <thead>
            <tr className="bg-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700`}>Item No</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700`}>Description</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700`}>Unit</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700`}>Qty</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700`}>Budget/Est</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700`} title="Working days">Days</th>
              <th className={`${colB} border-b border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700`}>Total</th>
              <th className="border-b border-zinc-300 dark:border-zinc-700" />
            </tr>
          </thead>
          <tbody>
            {bodyRows}
            {topSections.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Blank bill. Add a section — like <b>Preliminaries</b> or <b>Earthworks</b> — then add priced items or sub-sections.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
              <td className="px-2.5 py-3" colSpan={6}>
                Bill total
                <span className="ml-2 font-mono text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {items.length} items · {topSections.length} section{topSections.length === 1 ? '' : 's'}
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
            onClick={() => onAddSection(null)}
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
