import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MediaUploader } from '@/components/task/media-uploader';
import { offerCommitment, respondCommitment, decideCommitment } from '@/app/(app)/projects/[projectId]/tasks/actions';
import { formatUsd, paymentTermsSummary, type CommitmentStatus } from '@datumpro/shared/domain';
import type { CommitmentRow, TaskMediaRow } from '@/lib/data/commitments';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS_TONE: Record<CommitmentStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  offered: 'neutral',
  accepted: 'blue',
  counter_proposed: 'amber',
  agreed: 'green',
  declined: 'amber',
  cancelled: 'neutral',
};

interface Props {
  taskId: string;
  projectId: string;
  orgId: string;
  canManage: boolean;
  currentUserId: string;
  commitment: CommitmentRow | null;
  contractors: { userId: string; name: string }[];
  quoteMedia: TaskMediaRow[];
}

export function CommitmentPanel({
  taskId,
  projectId,
  orgId,
  canManage,
  currentUserId,
  commitment,
  contractors,
  quoteMedia,
}: Props) {
  const isContractor = !!commitment && commitment.contractorId === currentUserId;

  return (
    <Card className="mt-6">
      <CardTitle>Contractor commitment</CardTitle>

      {/* No commitment yet */}
      {!commitment && (
        <div className="mt-3">
          {canManage ? (
            contractors.length > 0 ? (
              <form action={offerCommitment} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="taskId" value={taskId} />
                <div className="min-w-48 flex-1">
                  <label className="mb-1 block text-xs font-medium">Offer to contractor</label>
                  <select name="contractorId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Select…
                    </option>
                    {contractors.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit">Offer task</Button>
              </form>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Add a contractor to this project (Team tab) to offer them the task.
              </p>
            )
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Not yet assigned to a contractor.</p>
          )}
        </div>
      )}

      {/* Existing commitment */}
      {commitment && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 dark:text-zinc-400">
              {commitment.contractorName ?? 'Contractor'}
            </span>
            <Badge tone={STATUS_TONE[commitment.status]}>{commitment.status.replace('_', ' ')}</Badge>
          </div>

          {commitment.costCents != null && (
            <Info label="Quoted cost" value={formatUsd(commitment.costCents)} />
          )}
          {commitment.agreedCostCents != null && commitment.status === 'agreed' && (
            <Info label="Agreed cost" value={formatUsd(commitment.agreedCostCents)} />
          )}
          {(commitment.proposedStart || commitment.proposedEnd) && (
            <Info
              label="Proposed timeline"
              value={`${commitment.proposedStart ?? '?'} → ${commitment.proposedEnd ?? '?'}`}
            />
          )}
          {(commitment.paymentTerms.advancePct || commitment.paymentTerms.retentionPct) && (
            <Info label="Payment terms" value={paymentTermsSummary(commitment.paymentTerms)} />
          )}
          {commitment.justification && (
            <p className="rounded-md bg-zinc-50 p-2 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              {commitment.justification}
            </p>
          )}
          {quoteMedia.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quoteMedia.map((m) => (
                <a
                  key={m.id}
                  href={m.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-500 underline"
                >
                  {m.caption || 'Quote document'}
                </a>
              ))}
            </div>
          )}

          {/* Contractor responds to an offer */}
          {commitment.status === 'offered' && isContractor && (
            <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <p className="text-xs font-medium">Respond to this offer</p>
              <form action={respondCommitment} className="space-y-2">
                <input type="hidden" name="taskId" value={taskId} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium">Your cost (USD)</label>
                    <input name="costDollars" type="number" step="0.01" placeholder="0.00" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium">Advance %</label>
                      <input name="advancePct" type="number" min={0} max={100} placeholder="0" className={inputClass} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium">Retention %</label>
                      <input name="retentionPct" type="number" min={0} max={100} placeholder="0" className={inputClass} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium">Proposed start</label>
                    <input name="proposedStart" type="date" className={inputClass} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium">Proposed end</label>
                    <input name="proposedEnd" type="date" className={inputClass} />
                  </div>
                </div>
                <textarea name="justification" rows={2} placeholder="Scope of works / cost justification" className={inputClass} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="decision" value="accept">Accept &amp; quote</Button>
                  <Button type="submit" name="decision" value="counter" variant="secondary">Counter-propose</Button>
                  <Button type="submit" name="decision" value="decline" variant="ghost">Decline</Button>
                </div>
              </form>
              <div>
                <p className="mb-1 text-[11px] text-zinc-500">Attach a quote / invoice (optional)</p>
                <MediaUploader
                  taskId={taskId}
                  projectId={projectId}
                  orgId={orgId}
                  purpose="quote"
                  label="Attach quote"
                  accept="image/*,application/pdf"
                />
              </div>
            </div>
          )}

          {commitment.status === 'offered' && !isContractor && (
            <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
              Waiting for the contractor to respond.
            </p>
          )}

          {/* PM decides on the response */}
          {(commitment.status === 'accepted' || commitment.status === 'counter_proposed') &&
            canManage && (
              <form
                action={decideCommitment}
                className="flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
              >
                <input type="hidden" name="taskId" value={taskId} />
                <Button type="submit" name="decision" value="agree">Agree &amp; lock cost</Button>
                <Button type="submit" name="decision" value="decline" variant="secondary">Decline</Button>
              </form>
            )}

          {(commitment.status === 'accepted' || commitment.status === 'counter_proposed') &&
            !canManage && (
              <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
                Submitted — awaiting the PM&apos;s decision.
              </p>
            )}

          {commitment.status === 'agreed' && (
            <p className="border-t border-zinc-100 pt-3 text-xs text-green-600 dark:text-green-400">
              ✓ Agreed — this cost is the task&apos;s earned-value weight.
            </p>
          )}
          {commitment.status === 'declined' && (
            <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
              This commitment was declined.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
