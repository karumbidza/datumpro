'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { requestPayment } from '@/app/(app)/payments/request-actions';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@datumpro/shared/domain';

const BUCKET = 'project-media';

/** A task the caller can invoice against — approved plan, with room left to claim. */
export type RequestTask = {
  taskId: string;
  title: string;
  projectId: string;
  orgId: string;
  projectName: string;
  requestableCents: number;
};

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** The assignee's "Request payment" form — invoice a task with an approved plan.
 *  Amount is capped at what's still claimable; an invoice is mandatory. */
export function RequestPaymentForm({ tasks, taskId }: { tasks: RequestTask[]; taskId?: string }) {
  const router = useRouter();
  const claimable = tasks.filter((t) => t.requestableCents > 0);
  const [open, setOpen] = useState(false);
  const preselect = taskId && claimable.some((t) => t.taskId === taskId) ? taskId : claimable[0]?.taskId ?? '';
  const [selId, setSelId] = useState(preselect);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const task = claimable.find((t) => t.taskId === selId);
  const maxDollars = task ? task.requestableCents / 100 : 0;

  function pickTask(id: string) {
    setSelId(id);
    const t = claimable.find((x) => x.taskId === id);
    if (t) setAmount((t.requestableCents / 100).toFixed(2)); // default to the full outstanding
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!task) return setError('Pick a task to invoice.');
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a valid amount.');
    if (cents > task.requestableCents) return setError(`You can request up to ${formatUsd(task.requestableCents)}.`);
    if (!file) return setError('Attach your invoice to proceed.');

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${task.orgId}/${task.projectId}/payment-requests/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const fd = new FormData();
      fd.set('projectId', task.projectId);
      fd.set('taskId', task.taskId);
      fd.set('title', task.title);
      fd.set('amountCents', String(cents));
      if (note.trim()) fd.set('note', note.trim());
      fd.set('invoicePath', path);
      fd.set('invoiceName', file.name);

      const res = await requestPayment(fd);
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
    return <Button onClick={() => setOpen(true)}>Request payment</Button>;
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New payment request</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>

      {claimable.length > 1 ? (
        <label className="block text-xs font-medium text-zinc-500">
          Task (approved plan)
          <select value={selId} onChange={(e) => pickTask(e.target.value)} className={inputClass}>
            {claimable.map((t) => (
              <option key={t.taskId} value={t.taskId}>
                {t.projectName} · {t.title} — {formatUsd(t.requestableCents)} left
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block text-xs font-medium text-zinc-500">
        Amount (USD) <span className="text-zinc-400">· up to {formatUsd(task?.requestableCents ?? 0)}</span>
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

      <label className="block text-xs font-medium text-zinc-500">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the reviewer should know" className={inputClass} />
      </label>

      <label className="block text-xs font-medium text-zinc-500">
        Invoice <span className="text-red-500">*</span> <span className="text-zinc-400">· PDF, image or Excel — required</span>
        <input
          type="file"
          accept="application/pdf,image/*,.xls,.xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit request'}
      </Button>
    </form>
  );
}
