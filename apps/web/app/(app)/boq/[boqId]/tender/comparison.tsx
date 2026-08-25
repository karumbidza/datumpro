'use client';

import type { TenderComparison } from '@/lib/data/tender';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { awardTender } from './actions';

interface Props {
  data: TenderComparison;
  boqId: string;
  canManage: boolean;
}

/** Format a variance percentage as a signed string with 1 decimal place. */
function fmtVariancePct(pct: number): string {
  const sign = pct >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pct * 100).toFixed(1)}%`;
}

export function Comparison({ data, boqId, canManage }: Props) {
  const { sections, bidders, currency, budgetTotalCents, awardedBidderId, status, tenderId } = data;

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Budget total:{' '}
          <span className="font-mono font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
            {fmtMoney(budgetTotalCents, currency)}
          </span>
        </span>
        <span className="text-zinc-300 dark:text-zinc-600">·</span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {bidders.length} bidder{bidders.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Comparison matrix */}
      <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
        <table className="w-full border-collapse text-sm" style={{ minWidth: `${420 + bidders.length * 180}px` }}>
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-28" />
            <col className="w-32" />
            {bidders.map((b) => (
              <col key={b.bidderId} className="w-44" />
            ))}
          </colgroup>

          {/* ── Column headers ── */}
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
                Budget/Est
              </th>
              <th className="border-b border-r border-zinc-300 px-2.5 py-2.5 text-right font-semibold dark:border-zinc-700">
                Budget total
              </th>
              {bidders.map((bidder) => {
                const isAwarded = awardedBidderId === bidder.bidderId;
                const variancePct = bidder.variancePct;
                const variancePositive = variancePct >= 0;
                const showAwardForm = canManage && status !== 'awarded';
                const unpricedCount = bidder.totalLines - bidder.pricedLines;

                return (
                  <th
                    key={bidder.bidderId}
                    className={`border-b border-r border-zinc-300 px-3 py-2.5 text-left font-semibold last:border-r-0 dark:border-zinc-700 ${
                      isAwarded ? 'bg-green-50 dark:bg-green-500/10' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-zinc-700 dark:text-zinc-300 normal-case text-xs font-semibold">
                          {bidder.companyName}
                        </span>
                        <Badge tone={bidder.rank === 1 ? 'green' : 'neutral'}>
                          #{bidder.rank}
                        </Badge>
                        {isAwarded && (
                          <Badge tone="green">Awarded ✓</Badge>
                        )}
                        {bidder.isComplete ? (
                          <Badge tone="green">✓ complete</Badge>
                        ) : (
                          <Badge tone="amber">
                            ⚠ priced {bidder.pricedLines}/{bidder.totalLines} (
                            {Math.round(bidder.coveragePct * 100)}%)
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono tabular-nums text-xs font-medium text-zinc-700 dark:text-zinc-300 normal-case">
                          {fmtMoney(bidder.totalCents, currency)}
                        </span>
                        <span
                          className={`font-mono tabular-nums text-xs normal-case font-medium ${
                            variancePositive
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-green-700 dark:text-green-400'
                          }`}
                        >
                          {fmtVariancePct(variancePct)}
                        </span>
                      </div>
                      {bidder.totalDays > 0 && (
                        <span className="font-mono tabular-nums text-[11px] normal-case text-zinc-500 dark:text-zinc-400">
                          ~{bidder.totalDays}d work
                          {bidder.programmeDays != null ? ` · ~${bidder.programmeDays}d programme` : ''}
                        </span>
                      )}
                      {showAwardForm && (
                        <form
                          action={awardTender}
                          onSubmit={(e) => {
                            const message = bidder.isComplete
                              ? `Award this tender to ${bidder.companyName}? All bidders will be notified.`
                              : `${bidder.companyName} left ${unpricedCount} of ${bidder.totalLines} lines unpriced. Award anyway? All bidders will be notified.`;
                            if (!window.confirm(message)) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="tenderId" value={tenderId} />
                          <input type="hidden" name="bidderId" value={bidder.bidderId} />
                          <input type="hidden" name="boqId" value={boqId} />
                          <Button type="submit" variant="secondary" size="sm" className="mt-0.5 normal-case text-[11px]">
                            Award
                          </Button>
                        </form>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Body: sections + item rows ── */}
          <tbody>
            {sections.map((section, sIdx) => (
              <>
                {/* Section header row */}
                <tr
                  key={`section-${section.sectionId}`}
                  className="bg-zinc-50 dark:bg-zinc-900/50"
                >
                  <td
                    className="border-b border-r border-zinc-200 px-2.5 py-2 text-center font-mono text-xs font-bold text-zinc-500 dark:border-zinc-800"
                  >
                    {sIdx + 1}
                  </td>
                  <td
                    colSpan={5 + bidders.length}
                    className="border-b border-zinc-200 px-2.5 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                  >
                    {section.name}
                  </td>
                </tr>

                {/* Item rows */}
                {section.items.map((item, iIdx) => {
                  // Compute lowest and highest amount among bidders for this row (ignore missing/noBid)
                  const bidderAmounts = bidders.map((b) => {
                    const rate = b.rates[item.itemId];
                    if (!rate || rate.noBid) return null;
                    return rate.amountCents;
                  });
                  const validAmounts = bidderAmounts.filter((a): a is number => a !== null);
                  const minAmount = validAmounts.length >= 2 ? Math.min(...validAmounts) : null;
                  const maxAmount = validAmounts.length >= 2 ? Math.max(...validAmounts) : null;

                  return (
                    <tr
                      key={item.itemId}
                      className="border-b border-zinc-100 last:border-0 hover:bg-brand-50/30 dark:border-zinc-800 dark:hover:bg-brand-600/5"
                    >
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-center font-mono text-xs text-zinc-400 dark:border-zinc-800">
                        {sIdx + 1}.{iIdx + 1}
                      </td>
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                        {item.description}
                      </td>
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-center text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        {item.uom ?? '—'}
                      </td>
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        {item.qty}
                      </td>
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        {fmtMoney(item.budgetRateCents, currency, 2)}
                      </td>
                      <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                        {fmtMoney(item.budgetAmountCents, currency)}
                      </td>
                      {bidders.map((bidder) => {
                        const rate = bidder.rates[item.itemId];
                        if (!rate || rate.noBid) {
                          return (
                            <td
                              key={bidder.bidderId}
                              className="border-r border-zinc-200 px-2.5 py-2 text-center text-zinc-400 last:border-r-0 dark:border-zinc-800 dark:text-zinc-500"
                            >
                              —
                            </td>
                          );
                        }
                        const amount = rate.amountCents;
                        const isLowest = minAmount !== null && amount === minAmount;
                        const isHighest = maxAmount !== null && amount === maxAmount && minAmount !== maxAmount;

                        return (
                          <td
                            key={bidder.bidderId}
                            className={`border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums last:border-r-0 dark:border-zinc-800 ${
                              isLowest
                                ? 'font-medium text-green-700 dark:text-green-400'
                                : isHighest
                                  ? 'font-medium text-red-600 dark:text-red-400'
                                  : 'text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            {fmtMoney(amount, currency)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>

          {/* ── Totals row ── */}
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
              <td colSpan={5} className="px-2.5 py-3 text-sm">
                Totals
              </td>
              <td className="border-l border-zinc-300 px-2.5 py-3 text-right font-mono tabular-nums text-brand-600 dark:border-zinc-700 dark:text-brand-500">
                {fmtMoney(budgetTotalCents, currency)}
              </td>
              {bidders.map((bidder) => (
                <td
                  key={bidder.bidderId}
                  className={`border-l border-zinc-300 px-2.5 py-3 text-right font-mono tabular-nums dark:border-zinc-700 ${
                    awardedBidderId === bidder.bidderId
                      ? 'text-green-700 dark:text-green-400'
                      : bidder.rank === 1
                        ? 'text-brand-600 dark:text-brand-500'
                        : 'text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {fmtMoney(bidder.totalCents, currency)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
