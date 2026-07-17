import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { inviteQuotes, awardQuote } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { QuoteSubmitForm } from './quote-submit-form';
import { formatUsd, paymentTermsSummary } from '@datumpro/shared/domain';
import type { QuoteRow, QuoteStatus } from '@/lib/data/quotes';

const STATUS_TONE: Record<QuoteStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  invited: 'neutral',
  submitted: 'blue',
  declined: 'amber',
  awarded: 'green',
  not_selected: 'neutral',
};

interface Props {
  taskId: string;
  projectId: string;
  orgId: string;
  canManage: boolean;
  currentUserId: string;
  quotes: QuoteRow[];
  contractors: { userId: string; name: string }[];
}

export function QuotePanel({ taskId, canManage, currentUserId, quotes, contractors }: Props) {
  const myQuote = quotes.find((q) => q.contractorId === currentUserId) ?? null;
  const invited = new Set(quotes.map((q) => q.contractorId));
  const availableToInvite = contractors.filter((c) => !invited.has(c.userId));
  const hasAward = quotes.some((q) => q.status === 'awarded');

  return (
    <Card className="mt-6">
      <CardTitle>Quotes</CardTitle>

      {canManage ? (
        <div className="mt-3 space-y-4">
          {/* Invite contractors */}
          {availableToInvite.length > 0 ? (
            <form action={inviteQuotes} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
              <input type="hidden" name="taskId" value={taskId} />
              <p className="mb-2 text-xs font-medium">Invite contractors to quote</p>
              <div className="flex flex-wrap gap-3">
                {availableToInvite.map((c) => (
                  <label key={c.userId} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="contractorIds" value={c.userId} />
                    {c.name}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <SubmitButton pendingText="Inviting…">Invite selected</SubmitButton>
              </div>
            </form>
          ) : (
            quotes.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Add contractors to this project (Team tab) to invite them to quote.
              </p>
            )
          )}

          {/* All quotes to compare */}
          {quotes.length > 0 && (
            <ul className="space-y-2">
              {quotes.map((q) => (
                <li
                  key={q.id}
                  className={`rounded-md border p-3 text-sm ${
                    q.status === 'awarded'
                      ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20'
                      : q.status === 'not_selected'
                        ? 'border-zinc-100 opacity-70 dark:border-zinc-800'
                        : 'border-zinc-100 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{q.contractorName ?? 'Contractor'}</span>
                    <Badge tone={STATUS_TONE[q.status]}>{q.status.replace('_', ' ')}</Badge>
                  </div>
                  {q.costCents != null && (
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatUsd(q.costCents)}</p>
                  )}
                  {(q.proposedStart || q.proposedEnd) && (
                    <p className="text-xs text-zinc-500">
                      {q.proposedStart ?? '?'} → {q.proposedEnd ?? '?'}
                    </p>
                  )}
                  {(q.paymentTerms.advancePct || q.paymentTerms.retentionPct) && (
                    <p className="text-xs text-zinc-500">{paymentTermsSummary(q.paymentTerms)}</p>
                  )}
                  {q.justification && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{q.justification}</p>}
                  {q.quoteUrl && (
                    <a href={q.quoteUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-500 underline">
                      Quote document
                    </a>
                  )}
                  {q.status === 'submitted' && !hasAward && (
                    <form action={awardQuote} className="mt-2">
                      <input type="hidden" name="taskId" value={taskId} />
                      <input type="hidden" name="quoteId" value={q.id} />
                      <Button type="submit">Award this quote</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : myQuote ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 dark:text-zinc-400">Your quote</span>
            <Badge tone={STATUS_TONE[myQuote.status]}>{myQuote.status.replace('_', ' ')}</Badge>
          </div>

          {myQuote.status === 'invited' ? (
            <QuoteSubmitForm taskId={taskId} />
          ) : (
            <>
              {myQuote.costCents != null && (
                <p className="text-lg font-semibold tabular-nums">{formatUsd(myQuote.costCents)}</p>
              )}
              <p className="text-xs text-zinc-500">
                {myQuote.status === 'submitted' && 'Submitted — awaiting the PM’s decision.'}
                {myQuote.status === 'awarded' && '✓ You were awarded this task.'}
                {myQuote.status === 'not_selected' && 'Another quote was selected.'}
                {myQuote.status === 'declined' && 'You declined to quote.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Quote amounts are confidential to the project manager and the contractor they belong to.
        </p>
      )}
    </Card>
  );
}
