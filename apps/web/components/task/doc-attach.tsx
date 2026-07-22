'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { recordTaskDocument, removeTaskDocument } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { TaskDoc } from '@/lib/data/tenders';

const BUCKET = 'project-media';

/** BoQ / invoice PDF attachments for a plan or a sealed bid. Uploads straight to
 *  storage (RLS enforces access — task-scoped for tender invitees), records the
 *  row, and lists the docs with a view link. `bid` scopes it to the uploader's
 *  own sealed bid. */
export function DocAttach({
  taskId,
  projectId,
  orgId,
  docs,
  bid = false,
  canEdit,
}: {
  taskId: string;
  projectId: string;
  orgId: string;
  docs: TaskDoc[];
  bid?: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const ext = (file.name.includes('.') ? file.name.split('.').pop() : 'bin')!.toLowerCase().slice(0, 8);
      const path = `${orgId}/${projectId}/tasks/${taskId}/docs/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (upErr) throw upErr;
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('path', path);
      fd.set('filename', file.name);
      fd.set('kind', /invoice/i.test(file.name) ? 'invoice' : 'boq');
      if (bid) fd.set('bid', '1');
      await recordTaskDocument(fd);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">BoQ / invoice (PDF, Excel, CSV)</p>
      {docs.length > 0 && (
        <ul className="mb-2 space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <a
                href={d.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-brand-600 hover:underline"
              >
                <span aria-hidden>📄</span>
                <span className="truncate">{d.filename}</span>
              </a>
              {canEdit && (
                <form action={removeTaskDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <button type="submit" className="text-[11px] text-zinc-400 hover:text-red-500" title="Remove">
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <label
          className={`inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-4 text-[13.5px] font-medium text-zinc-700 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-brand-500/10 ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <span aria-hidden className="opacity-60">📎</span>
          <input
            type="file"
            accept=".pdf,.xls,.xlsx,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={onChange}
            disabled={busy}
          />
          {busy ? 'Uploading…' : docs.length > 0 ? 'Attach another file' : 'Attach BoQ / invoice'}
        </label>
      )}
      {!canEdit && docs.length === 0 && <p className="text-sm text-zinc-400">No documents attached.</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
