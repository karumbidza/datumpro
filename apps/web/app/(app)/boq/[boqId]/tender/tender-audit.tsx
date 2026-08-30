import type { BidderRow } from '@/lib/data/tender';
import { BIDDER_STATUS_LABELS } from '@datumpro/shared/domain';
import { Badge } from '@/components/ui/badge';
import { BIDDER_STATUS_TONE } from '@/components/ui/tones';
import { LocalDateTime } from '@/components/ui/local-datetime';
import { theadRowClass, thClass } from '@/components/ui/table';

/** Read-only audit trail for an unsealed/awarded tender: who was invited, who
 *  participated, when, and who won. Managers only — rendered above the price
 *  comparison. Times render in the viewer's timezone via LocalDateTime. */
export function TenderAudit({
  bidders,
  awardedBidderId,
}: {
  bidders: BidderRow[];
  awardedBidderId: string | null;
}) {
  const submitted = bidders.filter((b) => b.status === 'submitted').length;

  // "Did they engage with the tender?" — submitted counts; withdrawn is called
  // out separately; invited/viewing at this stage means they never bid.
  function participation(b: BidderRow): { label: string; tone: 'green' | 'red' | 'faint' } {
    if (b.status === 'submitted') return { label: 'Submitted a bid', tone: 'green' };
    if (b.status === 'withdrawn') return { label: 'Withdrew', tone: 'faint' };
    return { label: 'Did not participate', tone: 'red' };
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Tender audit</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {submitted} of {bidders.length} invited {bidders.length === 1 ? 'contractor' : 'contractors'} submitted a bid
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className={theadRowClass}>
              <th className={thClass}>Contractor</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Invited</th>
              <th className={thClass}>Submitted</th>
              <th className={thClass}>Participation</th>
            </tr>
          </thead>
          <tbody>
            {bidders.map((b) => {
              const won = awardedBidderId !== null && b.id === awardedBidderId;
              const part = participation(b);
              return (
                <tr
                  key={b.id}
                  className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
                    won ? 'bg-green-50/60 dark:bg-green-950/20' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                      {b.companyName}
                      {won && <span title="Awarded the tender">🏆</span>}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{b.contactEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    {won ? (
                      <Badge tone="green">Won</Badge>
                    ) : (
                      <Badge tone={BIDDER_STATUS_TONE[b.status] ?? 'neutral'}>
                        {BIDDER_STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {b.invitedAt ? <LocalDateTime iso={b.invitedAt} /> : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {b.submittedAt ? <LocalDateTime iso={b.submittedAt} /> : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        part.tone === 'green'
                          ? 'text-green-700 dark:text-green-400'
                          : part.tone === 'red'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-zinc-400 dark:text-zinc-500'
                      }
                    >
                      {part.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
