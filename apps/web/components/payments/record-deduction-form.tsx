'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { recordRetentionDeduction } from '@/app/(app)/projects/[projectId]/finance/actions';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import { formatUsd } from '@datumpro/shared/domain';

/** A contractor with retention held on this project, for the deduction picker. */
export type DeductionContractor = {
  contractorId: string;
  contractorName: string | null;
  availableCents: number;
};

/** Manager form: spend held retention on repairs (poor workmanship) for one
 *  contractor. Recorded as an immutable deduction that reduces their release. */
export function RecordDeductionForm({ projectId, contractors }: { projectId: string; contractors: DeductionContractor[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selId, setSelId] = useState(contractors[0]?.contractorId ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contractor = contractors.find((c) => c.contractorId === selId) ?? contractors[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!contractor) return setError('Pick a contractor.');
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a valid amount.');
    if (!reason.trim()) return setError('Describe what the retention covered.');

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('contractorId', contractor.contractorId);
      fd.set('amountCents', String(cents));
      fd.set('reason', reason.trim());
      const res = await recordRetentionDeduction(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not record');
      setOpen(false);
      setAmount('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record');
    } finally {
      setBusy(false);
    }
  }

  if (contractors.length === 0) return null;

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Record deduction
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Spend retention on repairs</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>

      {contractors.length > 1 ? (
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Contractor
          <select value={selId} onChange={(e) => setSelId(e.target.value)} className={inputClass}>
            {contractors.map((c) => (
              <option key={c.contractorId} value={c.contractorId}>
                {c.contractorName ?? 'Contractor'} — {formatUsd(c.availableCents)} held
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Amount (USD) <span className="text-zinc-400 dark:text-zinc-500">· held {formatUsd(contractor?.availableCents ?? 0)}</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          className={inputClass}
        />
      </label>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Reason <span className="text-red-500">*</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Re-grouting failed tiling, block B"
          className={inputClass}
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Record deduction'}
      </Button>
    </form>
  );
}
