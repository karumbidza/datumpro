'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { issueContractorAdvance } from '@/app/(app)/projects/[projectId]/finance/actions';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';

export type AdvanceMember = { userId: string; name: string | null };

/** Manager form: issue (record) an advance to a project contractor. It's recouped
 *  from their progress claims as tasks complete. */
export function IssueAdvanceForm({ projectId, members }: { projectId: string; members: AdvanceMember[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selId, setSelId] = useState(members[0]?.userId ?? '');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!selId) return setError('Pick a contractor.');
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a valid amount.');

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('contractorId', selId);
      fd.set('amountCents', String(cents));
      if (reference.trim()) fd.set('reference', reference.trim());
      if (note.trim()) fd.set('note', note.trim());
      const res = await issueContractorAdvance(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not issue');
      setOpen(false);
      setAmount('');
      setReference('');
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue');
    } finally {
      setBusy(false);
    }
  }

  if (members.length === 0) return null;

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Issue advance</Button>;
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Issue advance</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>

      {members.length > 1 ? (
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Contractor
          <select value={selId} onChange={(e) => setSelId(e.target.value)} className={inputClass}>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? 'Contractor'}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Amount (USD)
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
        Reference (optional)
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" className={inputClass} />
      </label>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the advance is for" className={inputClass} />
      </label>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        Recorded now and recouped from this contractor&apos;s progress claims as tasks complete.
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Issuing…' : 'Issue advance'}
      </Button>
    </form>
  );
}
