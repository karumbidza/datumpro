'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { Layers, Download, Plus } from '@/components/icons';
import {
  DISCIPLINE_LABEL,
  STATUS_LABEL,
  type Drawing,
  type DrawingRevision,
  type Discipline,
  type RevisionStatus,
} from '@/lib/data/drawings-types';
import {
  createDrawing,
  addRevision,
  deleteRevision,
  deleteDrawing,
} from '@/app/(app)/projects/[projectId]/drawings/actions';

const BUCKET = 'project-media';
const DISCIPLINES: Discipline[] = [
  'architectural',
  'structural',
  'civil',
  'mechanical',
  'electrical',
  'plumbing',
  'landscape',
  'survey',
  'other',
];
const STATUSES: RevisionStatus[] = ['for_review', 'for_construction', 'for_information', 'as_built'];

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';

const STATUS_STYLE: Record<RevisionStatus, string> = {
  for_review: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  for_construction: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  for_information: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  as_built: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  superseded: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Upload a PDF to the project-media bucket (segment [2] = project authorises it). */
async function uploadPdf(file: File, orgId: string, projectId: string): Promise<{ storagePath: string; filename: string }> {
  const supabase = createClient();
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'pdf';
  const path = `${orgId}/${projectId}/drawings/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return { storagePath: path, filename: file.name };
}

function StatusBadge({ status }: { status: RevisionStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function NewDrawingForm({
  projectId,
  orgId,
  onDone,
  onCancel,
}: {
  projectId: string;
  orgId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState<Discipline>('architectural');
  const [revision, setRevision] = useState('A');
  const [status, setStatus] = useState<RevisionStatus>('for_review');
  const [issueDate, setIssueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (number.trim().length < 1) return setError('Give the drawing a number.');
    if (title.trim().length < 2) return setError('Give the drawing a title.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('number', number.trim());
      fd.set('title', title.trim());
      fd.set('discipline', discipline);
      fd.set('revision', revision.trim() || 'A');
      fd.set('status', status);
      if (issueDate) fd.set('issueDate', issueDate);
      if (file) {
        const up = await uploadPdf(file, orgId, projectId);
        fd.set('storagePath', up.storagePath);
        fd.set('filename', up.filename);
      }
      const res = await createDrawing(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not add drawing');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add drawing');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Drawing number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. S-101" autoFocus className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Discipline</span>
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} className={inputClass}>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {DISCIPLINE_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Foundation plan" className={inputClass} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>Revision</span>
          <input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="A" className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as RevisionStatus)} className={inputClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Issue date</span>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>PDF</span>
        <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Add drawing'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddRevisionForm({
  drawing,
  projectId,
  orgId,
  onDone,
  onCancel,
}: {
  drawing: Drawing;
  projectId: string;
  orgId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [revision, setRevision] = useState('');
  const [status, setStatus] = useState<RevisionStatus>('for_construction');
  const [issueDate, setIssueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!revision.trim()) return setError('Give the revision a label (e.g. B).');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('drawingId', drawing.id);
      fd.set('projectId', projectId);
      fd.set('revision', revision.trim());
      fd.set('status', status);
      if (issueDate) fd.set('issueDate', issueDate);
      if (file) {
        const up = await uploadPdf(file, orgId, projectId);
        fd.set('storagePath', up.storagePath);
        fd.set('filename', up.filename);
      }
      const res = await addRevision(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not add revision');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add revision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div>
        <span className={fieldLabel}>Revision</span>
        <input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="B" autoFocus className={`${inputClass} w-20`} />
      </div>
      <div>
        <span className={fieldLabel}>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as RevisionStatus)} className={inputClass}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={fieldLabel}>Issue date</span>
        <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
      </div>
      <div>
        <span className={fieldLabel}>PDF</span>
        <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-xs" />
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Issuing…' : 'Issue revision'}
      </Button>
      <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </form>
  );
}

function RevisionRow({
  rev,
  projectId,
  canManage,
}: {
  rev: DrawingRevision;
  projectId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  async function remove() {
    const fd = new FormData();
    fd.set('revisionId', rev.id);
    fd.set('projectId', projectId);
    await deleteRevision(fd);
    router.refresh();
  }
  return (
    <li className="flex items-center gap-2 py-1.5 text-xs">
      <span className="w-10 shrink-0 font-medium text-zinc-700 dark:text-zinc-200">Rev {rev.revision}</span>
      <StatusBadge status={rev.status} />
      <span className="text-zinc-400 dark:text-zinc-500">{fmtDate(rev.issueDate)}</span>
      {rev.uploadedByName && <span className="hidden text-zinc-400 sm:inline dark:text-zinc-500">· {rev.uploadedByName}</span>}
      <span className="ml-auto flex items-center gap-3">
        {rev.url && (
          <a href={rev.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
            <Download size={13} /> PDF
          </a>
        )}
        {canManage && (
          <button type="button" onClick={remove} className="text-zinc-400 hover:text-red-500 hover:underline">
            Delete
          </button>
        )}
      </span>
    </li>
  );
}

function DrawingCard({
  drawing,
  projectId,
  orgId,
  canManage,
}: {
  drawing: Drawing;
  projectId: string;
  orgId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [revising, setRevising] = useState(false);
  const current = drawing.current;

  async function remove() {
    const fd = new FormData();
    fd.set('id', drawing.id);
    fd.set('projectId', projectId);
    await deleteDrawing(fd);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-white">{drawing.number}</span>
            <span className="text-sm text-zinc-700 dark:text-zinc-200">{drawing.title}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {DISCIPLINE_LABEL[drawing.discipline]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            {current ? (
              <>
                <span className="font-medium text-zinc-600 dark:text-zinc-300">Rev {current.revision}</span>
                <StatusBadge status={current.status} />
                {current.issueDate && <span>Issued {fmtDate(current.issueDate)}</span>}
                <span>· {drawing.revisions.length} revision{drawing.revisions.length === 1 ? '' : 's'}</span>
              </>
            ) : (
              <span>No revisions yet</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px]">
          {current?.url && (
            <a href={current.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
              <Download size={14} /> Current PDF
            </a>
          )}
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-zinc-500 hover:underline dark:text-zinc-400">
            {expanded ? 'Hide' : 'History'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800/70">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {drawing.revisions.map((rev) => (
              <RevisionRow key={rev.id} rev={rev} projectId={projectId} canManage={canManage} />
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              {!revising && (
                <button type="button" onClick={() => setRevising(true)} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  + Issue revision
                </button>
              )}
              <button type="button" onClick={remove} className="text-zinc-400 hover:text-red-500 hover:underline">
                Delete drawing
              </button>
            </div>
          )}
          {revising && (
            <AddRevisionForm
              drawing={drawing}
              projectId={projectId}
              orgId={orgId}
              onDone={() => {
                setRevising(false);
                router.refresh();
              }}
              onCancel={() => setRevising(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The drawings register: a controlled catalogue of the project's drawings with
 *  their current revision, status and PDF, and the full revision history. Managers
 *  add drawings and issue revisions; everyone can view and download. */
export function DrawingsRegister({
  projectId,
  orgId,
  drawings,
  canManage,
}: {
  projectId: string;
  orgId: string;
  drawings: Drawing[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [discipline, setDiscipline] = useState<Discipline | 'all'>('all');

  const present = useMemo(() => [...new Set(drawings.map((d) => d.discipline))], [drawings]);
  const shown = useMemo(
    () => (discipline === 'all' ? drawings : drawings.filter((d) => d.discipline === discipline)),
    [drawings, discipline],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {adding ? null : (
          canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={15} />
                New drawing
              </span>
            </Button>
          )
        )}
        {present.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setDiscipline('all')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                discipline === 'all' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
              }`}
            >
              All
            </button>
            {present.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDiscipline(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  discipline === d ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                }`}
              >
                {DISCIPLINE_LABEL[d]}
              </button>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <NewDrawingForm
          projectId={projectId}
          orgId={orgId}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {drawings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <Layers size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {canManage
              ? 'No drawings yet. Add the first one — a number, title, discipline and the PDF.'
              : 'No drawings have been issued for this project yet.'}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">No drawings in this discipline.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((d) => (
            <DrawingCard key={d.id} drawing={d} projectId={projectId} orgId={orgId} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
