'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  approvePaymentRequest,
  rejectPaymentRequest,
  markPaymentRequestPaid,
} from '@/app/(app)/payments/request-actions';

const BUCKET = 'project-media';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

/** Manager controls for one payment request. RLS + the DB trigger are the hard
 *  gate; this is the operator surface for approve / reject / mark-paid(+POP). */
export function ManageRequest({
  id,
  orgId,
  projectId,
  status,
}: {
  id: string;
  orgId: string;
  projectId: string;
  status: 'requested' | 'approved' | 'paid' | 'rejected';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [pop, setPop] = useState<File | null>(null);

  async function run(fn: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn(fd);
      if (!res.ok) throw new Error(res.error ?? 'Failed');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function base() {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('projectId', projectId);
    return fd;
  }

  async function markPaid() {
    setBusy(true);
    setError(null);
    try {
      const fd = base();
      if (reference.trim()) fd.set('reference', reference.trim());
      if (pop) {
        const supabase = createClient();
        const ext = pop.name.includes('.') ? pop.name.split('.').pop() : 'bin';
        const path = `${orgId}/${projectId}/payment-requests/${crypto.randomUUID()}-pop.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, pop, { upsert: false });
        if (upErr) throw upErr;
        fd.set('popPath', path);
        fd.set('popName', pop.name);
      }
      const res = await markPaymentRequestPaid(fd);
      if (!res.ok) throw new Error(res.error ?? 'Failed');
      setPayOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'paid' || status === 'rejected') return null;

  async function confirmReject() {
    const fd = base();
    if (reason.trim()) fd.set('reviewNote', reason.trim());
    await run(rejectPaymentRequest, fd);
    setRejectOpen(false);
    setReason('');
  }

  return (
    <div className="mt-2">
      {rejectOpen ? (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Reason for rejecting <span className="text-zinc-400">(shared with the contractor)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder="e.g. Amount exceeds the agreed quote — please revise and resubmit."
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !reason.trim()}
              onClick={confirmReject}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setRejectOpen(false);
                setReason('');
              }}
              className="rounded-md px-3 py-1 text-xs text-zinc-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !payOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          {status === 'requested' && (
            <button
              disabled={busy}
              onClick={() => run(approvePaymentRequest, base())}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => setPayOpen(true)}
            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            Mark paid
          </button>
          <button
            disabled={busy}
            onClick={() => setRejectOpen(true)}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Payment reference (optional)"
            className={inputClass}
          />
          <label className="block text-xs text-zinc-500">
            Proof of payment (optional)
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setPop(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={markPaid}
              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Confirm paid'}
            </button>
            <button
              disabled={busy}
              onClick={() => setPayOpen(false)}
              className="rounded-md px-3 py-1 text-xs text-zinc-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
