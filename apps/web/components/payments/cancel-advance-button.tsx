'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelContractorAdvance } from '@/app/(app)/projects/[projectId]/finance/actions';

/** Cancel an advance issued in error. Confirms, then calls the RPC-backed action
 *  (the row is kept, status→cancelled). */
export function CancelAdvanceButton({ advanceId, projectId }: { advanceId: string; projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('advanceId', advanceId);
      fd.set('projectId', projectId);
      const res = await cancelContractorAdvance(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not cancel');
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-zinc-500 transition hover:text-red-600 hover:underline dark:text-zinc-400 dark:hover:text-red-400"
      >
        Cancel
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        {busy ? 'Cancelling…' : 'Confirm cancel'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-zinc-400 hover:underline dark:text-zinc-500">
        Keep
      </button>
      {error && <span className="text-red-500">{error}</span>}
    </span>
  );
}
