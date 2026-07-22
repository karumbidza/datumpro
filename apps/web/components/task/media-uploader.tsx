'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { recordTaskMedia } from '@/app/(app)/projects/[projectId]/tasks/actions';

const BUCKET = 'project-media';

/** Uploads a file straight to Storage from the browser (Storage RLS enforces
 *  project access), then records a task_media row via a server action. Path:
 *  {org}/{project}/tasks/{task}/{uuid}.{ext} — segment [2] is the project, which
 *  the tightened storage policy checks. */
export function MediaUploader({
  taskId,
  projectId,
  orgId,
  purpose,
  subtaskId,
  label = 'Upload photo / video',
  accept = 'image/*,video/*',
  compact = false,
  glyph = '＋',
}: {
  taskId: string;
  projectId: string;
  orgId: string;
  purpose: 'completion' | 'quote' | 'progress' | 'subtask';
  subtaskId?: string;
  label?: string;
  accept?: string;
  compact?: boolean;
  /** Icon shown in compact mode (e.g. a paperclip). */
  glyph?: string;
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
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${orgId}/${projectId}/tasks/${taskId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const kind = file.type.startsWith('video')
        ? 'video'
        : file.type.startsWith('image')
          ? 'photo'
          : 'document';
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('storagePath', path);
      fd.set('kind', kind);
      fd.set('purpose', purpose);
      if (subtaskId) fd.set('subtaskId', subtaskId);
      await recordTaskMedia(fd);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  if (compact) {
    return (
      <label
        title={label}
        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[15px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 ${
          busy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <input type="file" accept={accept} className="hidden" onChange={onChange} disabled={busy} />
        {busy ? '…' : glyph}
      </label>
    );
  }

  return (
    <div>
      <label
        className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
          busy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <input type="file" accept={accept} className="hidden" onChange={onChange} disabled={busy} />
        {busy ? 'Uploading…' : label}
      </label>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
