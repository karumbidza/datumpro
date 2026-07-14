'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { verifyContractorDocument, rejectContractorDocument } from '@/app/(app)/documents/actions';

/** Manager controls to verify or reject a contractor's compliance document. RLS +
 *  the DB trigger are the hard gate; this is the operator surface. */
export function ReviewDocument({ id, status }: { id: string; status: 'submitted' | 'verified' | 'rejected' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function act(fn: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, withNote = false) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('id', id);
      if (withNote && note.trim()) fd.set('reviewNote', note.trim());
      const res = await fn(fd);
      if (!res.ok) throw new Error(res.error ?? 'Failed');
      setRejecting(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  // Verified docs still allow re-rejection if something's wrong; rejected allow re-verify.
  return (
    <div className="mt-2">
      {rejecting ? (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => act(rejectContractorDocument, true)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
              Confirm reject
            </button>
            <button disabled={busy} onClick={() => setRejecting(false)} className="rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {status !== 'verified' && (
            <button disabled={busy} onClick={() => act(verifyContractorDocument)} className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50">
              Verify
            </button>
          )}
          {status !== 'rejected' && (
            <button disabled={busy} onClick={() => setRejecting(true)} className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Reject
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
