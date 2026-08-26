'use client';

import { useState, useTransition } from 'react';
import type { BidWorkspace, BidSection } from '@/lib/data/tender';
import { TENDER_STATUS_LABELS, BIDDER_STATUS_LABELS } from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { TENDER_STATUS_TONE, BIDDER_STATUS_TONE } from '@/components/ui/tones';
import { saveBidRate, submitBid } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocalItem {
  itemId: string;
  description: string;
  uom: string | null;
  qty: number;
  /** Rate in CENTS as stored in the DB. */
  rateCents: number;
}

interface LocalSection {
  sectionId: string;
  name: string;
  items: LocalItem[];
}

// ---------------------------------------------------------------------------
// Shared cell recipes — mirror boq-builder.tsx
// ---------------------------------------------------------------------------

const cell =
  'w-full bg-transparent px-2.5 py-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-inset focus:ring-brand-500 dark:focus:bg-zinc-950';
const numCell = `${cell} text-right font-mono tabular-nums`;

// ---------------------------------------------------------------------------
// Status badge mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BidWorkspaceView({ ws, token }: { ws: BidWorkspace; token: string }) {
  const [sections, setSections] = useState<LocalSection[]>(() =>
    ws.sections.map((s: BidSection) => ({
      sectionId: s.sectionId,
      name: s.name,
      items: s.items.map((it) => ({
        itemId: it.itemId,
        description: it.description,
        uom: it.uom,
        qty: it.qty,
        rateCents: ws.myRates[it.itemId]?.rateCents ?? 0,
      })),
    })),
  );

  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Derived closed state — when true all inputs become read-only.
  const deadlinePassed = !!(ws.closeAt && new Date(ws.closeAt) < new Date());
  const closed =
    ws.status !== 'open' || ws.bidderStatus === 'submitted' || deadlinePassed;

  // ---------------------------------------------------------------------------
  // Live totals
  // ---------------------------------------------------------------------------

  const itemTotal = (it: LocalItem) => Math.round(it.qty * it.rateCents);
  const sectionTotal = (s: LocalSection) =>
    s.items.reduce((a, it) => a + itemTotal(it), 0);
  const grand = sections.reduce((a, s) => a + sectionTotal(s), 0);
  const itemCount = sections.reduce((a, s) => a + s.items.length, 0);

  // ---------------------------------------------------------------------------
  // Patch helpers
  // ---------------------------------------------------------------------------

  const patchRate = (sectionId: string, itemId: string, rateCents: number) =>
    setSections((prev) =>
      prev.map((s) =>
        s.sectionId !== sectionId
          ? s
          : {
              ...s,
              items: s.items.map((it) =>
                it.itemId !== itemId ? it : { ...it, rateCents },
              ),
            },
      ),
    );

  const onRateBlur = (sectionId: string, itemId: string, raw: string) => {
    const rateCents = Math.round((Number(raw) || 0) * 100);
    patchRate(sectionId, itemId, rateCents);
    startTransition(async () => {
      await saveBidRate({ token, boqItemId: itemId, rateCents });
    });
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!window.confirm('Submit your bid? You cannot change it afterwards.')) return;
    setSubmitError(null);
    const fd = new FormData(e.currentTarget);
    const result = await submitBid(fd);
    if (result?.error) setSubmitError(result.error);
  };

  // ---------------------------------------------------------------------------
  // Deadline display
  // ---------------------------------------------------------------------------

  const deadlineLabel = ws.closeAt
    ? new Date(ws.closeAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'No deadline set';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {ws.companyName}
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">
            {ws.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={TENDER_STATUS_TONE[ws.status] ?? 'neutral'}>
              {TENDER_STATUS_LABELS[ws.status] ?? ws.status}
            </Badge>
            <Badge tone={BIDDER_STATUS_TONE[ws.bidderStatus] ?? 'neutral'}>
              {BIDDER_STATUS_LABELS[ws.bidderStatus] ?? ws.bidderStatus}
            </Badge>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Closes: {deadlineLabel}
            </span>
          </div>
        </div>

        {/* Submit button */}
        {!closed && (
          <form onSubmit={handleSubmit} className="shrink-0">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Submit bid'}
            </button>
          </form>
        )}
      </div>

      {/* Status banners */}
      {ws.bidderStatus === 'submitted' && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
          Bid submitted — your rates are sealed and no further changes are possible.
        </div>
      )}
      {ws.bidderStatus !== 'submitted' && closed && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          {deadlinePassed ? 'This tender has closed — the deadline has passed.' : 'This tender is closed and no longer accepting bids.'}
        </div>
      )}
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}
      {pending && (
        <p className="mb-2 text-xs text-zinc-400">Saving…</p>
      )}

      {/* Bill grid */}
      <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr className="bg-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">
                Item No
              </th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">
                Description
              </th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-left font-semibold dark:border-zinc-700">
                Unit
              </th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">
                Qty
              </th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">
                Your rate
              </th>
              <th className="border-b border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">
                Your total
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s, si) => (
              <SectionRows
                key={s.sectionId}
                index={si}
                section={s}
                closed={closed}
                // TODO: carry tender currency — currently defaults to USD
                currency="USD"
                itemTotal={itemTotal}
                sectionTotal={sectionTotal(s)}
                onRateBlur={onRateBlur}
              />
            ))}
            {sections.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  No items in this bill of quantities.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
              <td className="px-2.5 py-3" colSpan={5}>
                Bid total
                <span className="ml-2 font-mono text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
                  {sections.length} section{sections.length === 1 ? '' : 's'}
                </span>
              </td>
              <td className="border-l border-zinc-300 px-2.5 py-3 text-right tabular-nums text-brand-600 dark:border-zinc-700 dark:text-brand-500">
                {/* TODO: carry tender currency */}
                {fmtMoney(grand, 'USD')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section rows sub-component (no state of its own — driven entirely by parent)
// ---------------------------------------------------------------------------

function SectionRows({
  index,
  section,
  closed,
  currency,
  itemTotal,
  sectionTotal,
  onRateBlur,
}: {
  index: number;
  section: LocalSection;
  closed: boolean;
  currency: string;
  itemTotal: (it: LocalItem) => number;
  sectionTotal: number;
  onRateBlur: (sectionId: string, itemId: string, raw: string) => void;
}) {
  const rowBorder = 'border-b border-zinc-200 dark:border-zinc-800';
  const colBorder = 'border-r border-zinc-200 dark:border-zinc-800';

  return (
    <>
      {/* Section header row */}
      <tr className="bg-zinc-50 dark:bg-zinc-900/50">
        <td
          className={`${rowBorder} ${colBorder} px-2.5 py-2 text-center font-mono text-xs font-bold text-zinc-500`}
        >
          {index + 1}
        </td>
        <td className={`${rowBorder} ${colBorder} px-2.5 py-2`} colSpan={3}>
          <span className="text-sm font-semibold">{section.name}</span>
          <span className="ml-2 font-mono text-xs text-zinc-400">
            {section.items.length} item{section.items.length === 1 ? '' : 's'}
          </span>
        </td>
        <td
          className={`${rowBorder} px-2.5 py-2 text-right font-mono text-sm font-bold tabular-nums text-brand-600 dark:text-brand-500`}
          colSpan={2}
        >
          {fmtMoney(sectionTotal, currency)}
        </td>
      </tr>

      {/* Item rows */}
      {section.items.map((it, ii) => (
        <tr key={it.itemId} className="group hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
          <td
            className={`${rowBorder} ${colBorder} px-2.5 py-2 text-center font-mono text-xs text-zinc-400`}
          >
            {index + 1}.{ii + 1}
          </td>
          {/* Description — always read-only for bidders */}
          <td className={`${rowBorder} ${colBorder} px-2.5 py-2 text-sm`}>
            {it.description || <span className="text-zinc-400">(no description)</span>}
          </td>
          {/* Unit — read-only */}
          <td
            className={`${rowBorder} ${colBorder} px-2.5 py-2 text-center font-mono text-xs text-zinc-500`}
          >
            {it.uom ?? '—'}
          </td>
          {/* Qty — read-only */}
          <td
            className={`${rowBorder} ${colBorder} px-2.5 py-2 text-right font-mono text-sm tabular-nums`}
          >
            {it.qty.toLocaleString('en-US')}
          </td>
          {/* Rate — editable only while open */}
          <td className={`${rowBorder} ${colBorder} p-0`}>
            <input
              key={it.itemId}
              defaultValue={it.rateCents ? (it.rateCents / 100).toFixed(2) : ''}
              disabled={closed}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Your rate"
              onBlur={(e) => onRateBlur(section.sectionId, it.itemId, e.target.value)}
              className={numCell}
            />
          </td>
          {/* Live total */}
          <td
            className={`${rowBorder} px-2.5 py-2 text-right font-mono text-sm tabular-nums`}
          >
            {fmtMoney(itemTotal(it), currency)}
          </td>
        </tr>
      ))}
    </>
  );
}
