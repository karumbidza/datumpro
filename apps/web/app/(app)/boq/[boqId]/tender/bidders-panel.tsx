'use client';

import { useActionState, useState } from 'react';
import { BIDDER_STATUS_LABELS, type BidderStatus } from '@datumpro/shared/domain';
import type { BidderRow } from '@/lib/data/tender';
import { inviteBidder, resendBidInvite, revokeBidder } from './actions';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { FormError } from '@/components/ui/form-error';
import { inputClass, labelClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/submit-button';

export interface ContractorOption {
  id: string;
  name: string;
  email: string;
}

interface Props {
  tenderId: string;
  boqId: string;
  bidders: BidderRow[];
  contractors: ContractorOption[];
  canManage: boolean;
}

const BIDDER_TONE: Record<BidderStatus, BadgeTone> = {
  invited: 'blue',
  viewing: 'amber',
  submitted: 'green',
  withdrawn: 'faint',
};

/** Invite form — toggles between "From contractors" and "New by email". */
function InviteForm({
  tenderId,
  boqId,
  contractors,
}: {
  tenderId: string;
  boqId: string;
  contractors: ContractorOption[];
}) {
  const [state, formAction] = useActionState(inviteBidder, {});
  const [mode, setMode] = useState<'contractor' | 'new'>(contractors.length > 0 ? 'contractor' : 'new');
  const [selected, setSelected] = useState<ContractorOption | null>(contractors[0] ?? null);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const found = contractors.find((c) => c.id === e.target.value) ?? null;
    setSelected(found);
  };

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="boqId" value={boqId} />

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Invite:</span>
        {contractors.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setMode('contractor')}
              className={`rounded px-2.5 py-1 text-sm transition ${
                mode === 'contractor'
                  ? 'bg-brand-600 text-white'
                  : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 dark:border-zinc-600 dark:text-zinc-300'
              }`}
            >
              From contractors
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`rounded px-2.5 py-1 text-sm transition ${
                mode === 'new'
                  ? 'bg-brand-600 text-white'
                  : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 dark:border-zinc-600 dark:text-zinc-300'
              }`}
            >
              New by email
            </button>
          </>
        )}
      </div>

      <FormError error={state.error} />

      {mode === 'contractor' && contractors.length > 0 ? (
        <>
          <div>
            <label className={labelClass} htmlFor="contractor-select">
              Contractor
            </label>
            <select
              id="contractor-select"
              className={inputClass}
              onChange={handleSelect}
              defaultValue={contractors[0]?.id}
            >
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.email}
                </option>
              ))}
            </select>
          </div>
          {/* Populate hidden fields from selected contractor */}
          <input type="hidden" name="companyName" value={selected?.name ?? ''} />
          <input type="hidden" name="email" value={selected?.email ?? ''} />
          <input type="hidden" name="userId" value={selected?.id ?? ''} />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="companyName">
                Company name
              </label>
              <input
                id="companyName"
                name="companyName"
                required
                autoComplete="organization"
                className={inputClass}
                placeholder="e.g. Apex Contractors Ltd"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="email">
                Contact email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                placeholder="contact@example.com"
              />
            </div>
          </div>
          <input type="hidden" name="userId" value="" />
        </>
      )}

      <div className="flex justify-end">
        <SubmitButton pendingText="Inviting…" size="sm">
          Send invitation
        </SubmitButton>
      </div>
    </form>
  );
}

export function BiddersPanel({ tenderId, boqId, bidders, contractors, canManage }: Props) {
  const activeBidders = bidders.filter((b) => b.status !== 'withdrawn');
  const withdrawnBidders = bidders.filter((b) => b.status === 'withdrawn');

  return (
    <div className="space-y-6">
      {/* Sealed-bids notice */}
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Bids stay sealed until you unseal (coming in the comparison view).
      </p>

      {/* Invite form */}
      {canManage && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Invite a bidder</h2>
          <InviteForm tenderId={tenderId} boqId={boqId} contractors={contractors} />
        </div>
      )}

      {/* Bidder list */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Invited bidders{activeBidders.length > 0 ? ` (${activeBidders.length})` : ''}
        </h2>

        {bidders.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No bidders invited yet. Use the form above to send your first invitation.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                  <th className="border-b border-zinc-200 px-4 py-2.5 text-left font-semibold dark:border-zinc-700">
                    Company
                  </th>
                  <th className="border-b border-zinc-200 px-4 py-2.5 text-left font-semibold dark:border-zinc-700">
                    Email
                  </th>
                  <th className="border-b border-zinc-200 px-4 py-2.5 text-left font-semibold dark:border-zinc-700">
                    Status
                  </th>
                  <th className="border-b border-zinc-200 px-4 py-2.5 text-left font-semibold dark:border-zinc-700">
                    Submitted
                  </th>
                  {canManage && (
                    <th className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700" />
                  )}
                </tr>
              </thead>
              <tbody>
                {[...activeBidders, ...withdrawnBidders].map((b) => (
                  <tr
                    key={b.id}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${
                      b.status === 'withdrawn' ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{b.companyName}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{b.contactEmail}</td>
                    <td className="px-4 py-3">
                      <Badge tone={BIDDER_TONE[b.status] ?? 'neutral'}>
                        {BIDDER_STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {b.submittedAt
                        ? new Date(b.submittedAt).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        {b.status !== 'withdrawn' && (
                          <div className="flex items-center gap-2">
                            <form action={resendBidInvite}>
                              <input type="hidden" name="bidderId" value={b.id} />
                              <input type="hidden" name="boqId" value={boqId} />
                              <Button type="submit" variant="secondary" size="sm">
                                Resend
                              </Button>
                            </form>
                            <form action={revokeBidder}>
                              <input type="hidden" name="bidderId" value={b.id} />
                              <input type="hidden" name="boqId" value={boqId} />
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                className="text-red-600 hover:border-red-300 hover:text-red-700 dark:text-red-400"
                              >
                                Revoke
                              </Button>
                            </form>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
