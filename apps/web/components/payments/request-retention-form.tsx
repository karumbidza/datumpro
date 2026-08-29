'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { requestRetentionRelease } from '@/app/(app)/payments/request-actions';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import { formatUsd } from '@datumpro/shared/domain';

const BUCKET = 'project-media';

/** A project whose defects-liability period has elapsed and still owes retention. */
export type RetentionClaimProject = {
  projectId: string;
  projectName: string;
  orgId: string;
  availableCents: number;
};

/** The contractor's "Release retention" form — one project-level claim for the
 *  held retention, once releasable, with a mandatory invoice. */
export function RequestRetentionForm({ projects }: { projects: RetentionClaimProject[] }) {
  const router = useRouter();
  const claimable = projects.filter((p) => p.availableCents > 0);
  const [open, setOpen] = useState(false);
  const [selId, setSelId] = useState(claimable[0]?.projectId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = claimable.find((p) => p.projectId === selId) ?? claimable[0];
  const maxDollars = project ? project.availableCents / 100 : 0;

  function pick(id: string) {
    setSelId(id);
    const p = claimable.find((x) => x.projectId === id);
    if (p) setAmount((p.availableCents / 100).toFixed(2));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!project) return setError('Pick a project.');
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a valid amount.');
    if (cents > project.availableCents) return setError(`You can release up to ${formatUsd(project.availableCents)}.`);
    if (!file) return setError('Attach your invoice to proceed.');

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${project.orgId}/${project.projectId}/payment-requests/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const fd = new FormData();
      fd.set('projectId', project.projectId);
      fd.set('title', `Retention release — ${project.projectName}`);
      fd.set('amountCents', String(cents));
      if (note.trim()) fd.set('note', note.trim());
      fd.set('invoicePath', path);
      fd.set('invoiceName', file.name);

      const res = await requestRetentionRelease(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not submit');

      setOpen(false);
      setAmount('');
      setNote('');
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }

  if (claimable.length === 0) return null;

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Release retention</Button>;
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Release retention</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>

      {claimable.length > 1 ? (
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Project
          <select value={selId} onChange={(e) => pick(e.target.value)} className={inputClass}>
            {claimable.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName} — {formatUsd(p.availableCents)} held
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Amount (USD) <span className="text-zinc-400 dark:text-zinc-500">· up to {formatUsd(project?.availableCents ?? 0)}</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          min="0"
          max={maxDollars}
          placeholder={maxDollars.toFixed(2)}
          className={inputClass}
        />
      </label>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </label>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Invoice <span className="text-red-500">*</span> <span className="text-zinc-400 dark:text-zinc-500">· PDF, image or Excel — required</span>
        <input
          type="file"
          accept="application/pdf,image/*,.xls,.xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit release request'}
      </Button>
    </form>
  );
}
