'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { uploadContractorDocument } from '@/app/(app)/documents/actions';
import { MAX_PROJECT_MEDIA_BYTES, uploadSizeError } from '@/lib/upload-limits';
import { CONTRACTOR_DOC_TYPES, CONTRACTOR_DOC_TYPE_LABEL } from '@datumpro/shared/domain';
import { Button } from '@/components/ui/button';

const BUCKET = 'project-media';

import { inputCompactClass as inputClass } from '@/components/ui/form';

/** Contractor files a compliance document (tax clearance, company reg, …). */
export function UploadDocumentForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '');
  const [docType, setDocType] = useState<string>('tax_clearance');
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!orgId || !file) {
      setError('Choose an organization and a file.');
      return;
    }
    const sizeErr = uploadSizeError(file, MAX_PROJECT_MEDIA_BYTES);
    if (sizeErr) {
      setError(sizeErr);
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${orgId}/compliance/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const fd = new FormData();
      fd.set('orgId', orgId);
      fd.set('docType', docType);
      if (title.trim()) fd.set('title', title.trim());
      fd.set('storagePath', path);
      fd.set('fileName', file.name);
      if (expiry) fd.set('expiryDate', expiry);

      const res = await uploadContractorDocument(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not upload');

      setOpen(false);
      setTitle('');
      setExpiry('');
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload');
    } finally {
      setBusy(false);
    }
  }

  if (orgs.length === 0) return null;

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Add document</Button>;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New compliance document</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>

      {orgs.length > 1 && (
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Organization
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={inputClass}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <label className="block flex-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Type
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
            {CONTRACTOR_DOC_TYPES.map((t) => (
              <option key={t} value={t}>{CONTRACTOR_DOC_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="block w-40 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Expiry (optional)
          <input value={expiry} onChange={(e) => setExpiry(e.target.value)} type="date" className={inputClass} />
        </label>
      </div>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Label (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ZIMRA Tax Clearance 2026" className={inputClass} />
      </label>

      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        File (PDF or image)
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Submit document'}</Button>
    </form>
  );
}
