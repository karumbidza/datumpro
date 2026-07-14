'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { requestPayment } from '@/app/(app)/payments/request-actions';
import { Button } from '@/components/ui/button';

const BUCKET = 'project-media';

export type RequestProject = { id: string; name: string; orgId: string };
export type RequestDraw = { id: string; projectId: string; name: string; amountCents: number };

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Contractor's "Request payment" form — links to a scheduled draw or raises an
 *  ad-hoc invoice, with an optional uploaded invoice document. */
export function RequestPaymentForm({
  projects,
  draws,
}: {
  projects: RequestProject[];
  draws: RequestDraw[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [drawId, setDrawId] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId);

  function onPickDraw(id: string) {
    setDrawId(id);
    const d = draws.find((x) => x.id === id);
    if (d) {
      setProjectId(d.projectId);
      setTitle(d.name);
      setAmount((d.amountCents / 100).toFixed(2));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!project || !title.trim() || !Number.isFinite(cents) || cents <= 0) {
      setError('Pick a project, a title, and a valid amount.');
      return;
    }
    setBusy(true);
    try {
      let invoicePath: string | null = null;
      let invoiceName: string | null = null;
      if (file) {
        const supabase = createClient();
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
        const path = `${project.orgId}/${project.id}/payment-requests/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        invoicePath = path;
        invoiceName = file.name;
      }
      const fd = new FormData();
      fd.set('projectId', project.id);
      if (drawId) fd.set('scheduleId', drawId);
      fd.set('title', title.trim());
      fd.set('amountCents', String(cents));
      if (note.trim()) fd.set('note', note.trim());
      if (invoicePath) fd.set('invoicePath', invoicePath);
      if (invoiceName) fd.set('invoiceName', invoiceName);

      const res = await requestPayment(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not submit');

      setOpen(false);
      setDrawId('');
      setTitle('');
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

  if (projects.length === 0) return null;

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Request payment</Button>
    );
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

      {draws.length > 0 && (
        <label className="block text-xs font-medium text-zinc-500">
          Against a scheduled draw (optional)
          <select value={drawId} onChange={(e) => onPickDraw(e.target.value)} className={inputClass}>
            <option value="">— Ad-hoc invoice —</option>
            {draws.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · ${(d.amountCents / 100).toFixed(2)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-xs font-medium text-zinc-500">
        Project
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={!!drawId}
          className={inputClass}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 text-xs font-medium text-zinc-500">
          Description
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Foundations — 40%" className={inputClass} />
        </label>
        <label className="block w-32 text-xs font-medium text-zinc-500">
          Amount (USD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" placeholder="0.00" className={inputClass} />
        </label>
      </div>

      <label className="block text-xs font-medium text-zinc-500">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the reviewer should know" className={inputClass} />
      </label>

      <label className="block text-xs font-medium text-zinc-500">
        Invoice (optional — PDF or image)
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit request'}
      </Button>
    </form>
  );
}
