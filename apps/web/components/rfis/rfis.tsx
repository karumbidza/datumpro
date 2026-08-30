'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { HelpCircle, Paperclip, Download, Clock, Plus } from '@/components/icons';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  DISCIPLINE_LABEL,
  type Rfi,
  type RfiAttachment,
  type RfiPriority,
  type RfiStatus,
  type Discipline,
  type RfiDrawingRef,
} from '@/lib/data/rfis-types';
import {
  raiseRfi,
  updateRfi,
  answerRfi,
  closeRfi,
  reopenRfi,
  recordRfiAttachment,
  deleteRfiAttachment,
  deleteRfi,
} from '@/app/(app)/projects/[projectId]/rfis/actions';

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
const PRIORITIES: RfiPriority[] = ['low', 'medium', 'high', 'urgent'];

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';

export type RfiMember = { userId: string; name: string };

const PRIORITY_STYLE: Record<RfiPriority, string> = {
  low: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  medium: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};
const STATUS_STYLE: Record<RfiStatus, string> = {
  open: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  answered: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  closed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  reopened: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function isOverdue(dueDate: string | null, status: RfiStatus): boolean {
  if (!dueDate || status === 'answered' || status === 'closed') return false;
  return new Date(`${dueDate}T23:59:59`).getTime() < Date.now();
}

function Composer({
  projectId,
  members,
  drawings,
  rfi,
  onDone,
  onCancel,
}: {
  projectId: string;
  members: RfiMember[];
  drawings: RfiDrawingRef[];
  rfi?: Rfi;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(rfi?.subject ?? '');
  const [discipline, setDiscipline] = useState<Discipline>(rfi?.discipline ?? 'architectural');
  const [priority, setPriority] = useState<RfiPriority>(rfi?.priority ?? 'medium');
  const [assigneeId, setAssigneeId] = useState(rfi?.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(rfi?.dueDate ?? '');
  const [drawingId, setDrawingId] = useState(rfi?.drawingId ?? '');
  const [detail, setDetail] = useState(rfi?.detail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (subject.trim().length < 2) return setError('Give the RFI a subject.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('subject', subject.trim());
      fd.set('discipline', discipline);
      fd.set('priority', priority);
      fd.set('assigneeId', assigneeId);
      fd.set('dueDate', dueDate);
      fd.set('drawingId', drawingId);
      fd.set('detail', detail.trim());
      let res;
      if (rfi) {
        fd.set('id', rfi.id);
        res = await updateRfi(fd);
      } else {
        res = await raiseRfi(fd);
      }
      if (!res.ok) throw new Error(res.error ?? 'Could not save');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <label className="block">
        <span className={fieldLabel}>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Grid C beam depth vs. M&E duct clash" autoFocus className={inputClass} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
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
        <label className="block">
          <span className={fieldLabel}>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as RfiPriority)} className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Assign to (responder)</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Response due</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </label>
      </div>
      {drawings.length > 0 && (
        <label className="block">
          <span className={fieldLabel}>Reference a drawing (optional)</span>
          <select value={drawingId} onChange={(e) => setDrawingId(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {drawings.map((d) => (
              <option key={d.id} value={d.id}>
                {d.number} — {d.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className={fieldLabel}>Question / detail</span>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} placeholder="Describe the ambiguity and what you need confirmed…" className={`${inputClass} resize-y`} />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : rfi ? 'Save' : 'Raise RFI'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnswerForm({ rfi, onDone, onCancel }: { rfi: Rfi; onDone: () => void; onCancel: () => void }) {
  const [answer, setAnswer] = useState(rfi.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (answer.trim().length < 2) return setError('Write an answer.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('id', rfi.id);
      fd.set('projectId', rfi.projectId);
      fd.set('answer', answer.trim());
      const res = await answerRfi(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not save the answer');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the answer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
      <span className={fieldLabel}>Answer</span>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} autoFocus placeholder="The confirmed information…" className={`${inputClass} resize-y`} />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Submit answer'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AttachmentUploader({ rfiId, projectId, orgId }: { rfiId: string; projectId: string; orgId: string }) {
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
      const path = `${orgId}/${projectId}/rfis/${rfiId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const fd = new FormData();
      fd.set('rfiId', rfiId);
      fd.set('projectId', projectId);
      fd.set('storagePath', path);
      fd.set('filename', file.name);
      const res = await recordRfiAttachment(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not attach');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <input type="file" accept="application/pdf,image/*,.pdf" className="hidden" onChange={onChange} disabled={busy} />
        <Paperclip size={14} />
        {busy ? 'Uploading…' : 'Attach'}
      </label>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function AttachmentList({ attachments, projectId, canEdit }: { attachments: RfiAttachment[]; projectId: string; canEdit: boolean }) {
  const router = useRouter();
  if (attachments.length === 0) return null;
  async function remove(attachmentId: string) {
    const fd = new FormData();
    fd.set('attachmentId', attachmentId);
    fd.set('projectId', projectId);
    await deleteRfiAttachment(fd);
    router.refresh();
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li key={a.id} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
          {a.url ? (
            <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
              <Download size={12} /> {a.filename ?? 'File'}
            </a>
          ) : (
            <span className="text-zinc-500">{a.filename ?? 'File'}</span>
          )}
          {canEdit && (
            <button type="button" onClick={() => remove(a.id)} className="text-zinc-400 hover:text-red-500">
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function RfiCard({
  rfi,
  projectId,
  orgId,
  members,
  drawings,
  canModerate,
  currentUserId,
}: {
  rfi: Rfi;
  projectId: string;
  orgId: string;
  members: RfiMember[];
  drawings: RfiDrawingRef[];
  canModerate: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAssignee = rfi.assigneeId === currentUserId;
  const isRaiser = rfi.raisedBy === currentUserId;
  const canEdit = canModerate || isRaiser;
  const overdue = isOverdue(rfi.dueDate, rfi.status);

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', rfi.id);
    fd.set('projectId', projectId);
    await action(fd);
    setBusy(false);
    router.refresh();
  }

  if (editing) {
    return (
      <Composer
        projectId={projectId}
        members={members}
        drawings={drawings}
        rfi={rfi}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const canAnswer = (isAssignee || canModerate) && (rfi.status === 'open' || rfi.status === 'reopened');
  const canClose = (isRaiser || canModerate) && rfi.status === 'answered';
  const canReopen = (isRaiser || canModerate) && (rfi.status === 'answered' || rfi.status === 'closed');

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">RFI #{rfi.number}</span>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{rfi.subject}</h3>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_STYLE[rfi.priority]}`}>{PRIORITY_LABEL[rfi.priority]}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[rfi.status]}`}>{STATUS_LABEL[rfi.status]}</span>
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                <Clock size={11} /> Overdue
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span>{DISCIPLINE_LABEL[rfi.discipline]}</span>
            <span>{rfi.assigneeName ? `Responder: ${rfi.assigneeName}` : 'Unassigned'}</span>
            {rfi.dueDate && <span>Due {fmtDate(rfi.dueDate)}</span>}
            <span>Raised by {rfi.raisedByName ?? 'Member'}</span>
            {rfi.drawingId && (
              <Link href={`/projects/${projectId}/drawings`} className="text-brand-600 hover:underline dark:text-brand-400">
                {rfi.drawingNumber ?? 'Drawing'}
              </Link>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
              Edit
            </button>
            <button type="button" onClick={() => run(deleteRfi)} disabled={busy} className="text-zinc-400 hover:text-red-500 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      {rfi.detail && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{rfi.detail}</p>}

      {rfi.answer && (
        <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className={fieldLabel}>Answer{rfi.answeredByName ? ` · ${rfi.answeredByName}` : ''}{rfi.answeredAt ? ` · ${fmtDate(rfi.answeredAt)}` : ''}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{rfi.answer}</p>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <AttachmentList attachments={rfi.attachments} projectId={projectId} canEdit={canEdit} />
        {(canEdit || isAssignee) && <AttachmentUploader rfiId={rfi.id} projectId={projectId} orgId={orgId} />}
      </div>

      {(canAnswer || canClose || canReopen) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
          {canAnswer && !answering && (
            <Button size="sm" disabled={busy} onClick={() => setAnswering(true)}>
              Answer
            </Button>
          )}
          {canClose && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(closeRfi)}>
              Close
            </Button>
          )}
          {canReopen && (
            <button type="button" onClick={() => run(reopenRfi)} disabled={busy} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
              Reopen
            </button>
          )}
        </div>
      )}

      {answering && (
        <AnswerForm
          rfi={rfi}
          onDone={() => {
            setAnswering(false);
            router.refresh();
          }}
          onCancel={() => setAnswering(false)}
        />
      )}
    </div>
  );
}

type Filter = 'open' | 'closed' | 'all';

/** The RFI log: raise a formal question, assign a responder, record the answer,
 *  and close it out — optionally against a drawing from the register. */
export function RfisRegister({
  projectId,
  orgId,
  rfis,
  members,
  drawings,
  canModerate,
  currentUserId,
}: {
  projectId: string;
  orgId: string;
  rfis: Rfi[];
  members: RfiMember[];
  drawings: RfiDrawingRef[];
  canModerate: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const openCount = rfis.filter((r) => r.status !== 'closed').length;
  const shown = useMemo(() => {
    if (filter === 'all') return rfis;
    if (filter === 'open') return rfis.filter((r) => r.status !== 'closed');
    return rfis.filter((r) => r.status === 'closed');
  }, [rfis, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'open', label: `Open${openCount ? ` ${openCount}` : ''}` },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {adding ? null : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={15} />
              Raise an RFI
            </span>
          </Button>
        )}
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filter === f.key ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {adding && (
        <Composer
          projectId={projectId}
          members={members}
          drawings={drawings}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {rfis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <HelpCircle size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            No RFIs yet. Raise one when a drawing or spec needs clarifying — assign a responder and track it to a written answer.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">Nothing here — try another filter.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((rfi) => (
            <RfiCard
              key={rfi.id}
              rfi={rfi}
              projectId={projectId}
              orgId={orgId}
              members={members}
              drawings={drawings}
              canModerate={canModerate}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
