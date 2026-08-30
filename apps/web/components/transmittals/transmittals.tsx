'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { Send, Plus } from '@/components/icons';
import {
  PURPOSE_LABEL,
  METHOD_LABEL,
  type Transmittal,
  type TransmittalPurpose,
  type TransmittalMethod,
  type TransmittalDrawingOption,
} from '@/lib/data/transmittals-types';
import {
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
} from '@/app/(app)/projects/[projectId]/transmittals/actions';

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';
const PURPOSES: TransmittalPurpose[] = ['for_construction', 'for_review', 'for_approval', 'for_information', 'for_record'];
const METHODS: TransmittalMethod[] = ['email', 'hand', 'courier', 'portal', 'other'];

export type TransmittalMember = { userId: string; name: string };

const PURPOSE_STYLE: Record<TransmittalPurpose, string> = {
  for_construction: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  for_review: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  for_approval: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  for_information: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  for_record: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

function trRef(n: number): string {
  return `TR-${String(n).padStart(3, '0')}`;
}
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function Composer({
  projectId,
  drawings,
  members,
  transmittal,
  onDone,
  onCancel,
}: {
  projectId: string;
  drawings: TransmittalDrawingOption[];
  members: TransmittalMember[];
  transmittal?: Transmittal;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = !!transmittal;
  const [recipient, setRecipient] = useState(transmittal?.recipient ?? '');
  const [recipientUserId, setRecipientUserId] = useState(transmittal?.recipientUserId ?? '');
  const [purpose, setPurpose] = useState<TransmittalPurpose>(transmittal?.purpose ?? 'for_construction');
  const [method, setMethod] = useState<TransmittalMethod>(transmittal?.method ?? 'email');
  const [issuedDate, setIssuedDate] = useState(transmittal?.issuedDate ?? todayIso());
  const [notes, setNotes] = useState(transmittal?.notes ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (recipient.trim().length < 2) return setError('Who is it going to?');
    if (!editing && selected.size === 0) return setError('Add at least one drawing to transmit.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('recipient', recipient.trim());
      fd.set('recipientUserId', recipientUserId);
      fd.set('purpose', purpose);
      fd.set('method', method);
      fd.set('issuedDate', issuedDate);
      fd.set('notes', notes.trim());
      let res;
      if (transmittal) {
        fd.set('id', transmittal.id);
        res = await updateTransmittal(fd);
      } else {
        fd.set('revisionIds', [...selected].join(','));
        res = await createTransmittal(fd);
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Recipient</span>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. Quill Contractors" autoFocus className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Notify a member (optional)</span>
          <select value={recipientUserId} onChange={(e) => setRecipientUserId(e.target.value)} className={inputClass}>
            <option value="">No one</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Purpose</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as TransmittalPurpose)} className={inputClass}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as TransmittalMethod)} className={inputClass}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Issued date</span>
          <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className={inputClass} />
        </label>
      </div>

      {!editing && (
        <div>
          <span className={fieldLabel}>Drawings to transmit</span>
          {drawings.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              No drawings in the register yet — add some in Drawings first.
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              {drawings.map((d) => (
                <label key={d.revisionId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <input type="checkbox" checked={selected.has(d.revisionId)} onChange={() => toggle(d.revisionId)} />
                  <span className="font-mono text-xs text-zinc-700 dark:text-zinc-200">{d.number}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Rev {d.revision}</span>
                  <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{d.title}</span>
                </label>
              ))}
            </div>
          )}
          {selected.size > 0 && <p className="mt-1 text-[11px] text-zinc-400">{selected.size} selected</p>}
        </div>
      )}

      <label className="block">
        <span className={fieldLabel}>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. superseding the Rev B set" className={inputClass} />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Issue transmittal'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TransmittalCard({
  transmittal,
  projectId,
  drawings,
  members,
  canManage,
}: {
  transmittal: Transmittal;
  projectId: string;
  drawings: TransmittalDrawingOption[];
  members: TransmittalMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', transmittal.id);
    fd.set('projectId', projectId);
    await deleteTransmittal(fd);
    setBusy(false);
    router.refresh();
  }

  if (editing) {
    return (
      <Composer
        projectId={projectId}
        drawings={drawings}
        members={members}
        transmittal={transmittal}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-white">{trRef(transmittal.number)}</span>
            <span className="text-sm text-zinc-700 dark:text-zinc-200">to {transmittal.recipient}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PURPOSE_STYLE[transmittal.purpose]}`}>{PURPOSE_LABEL[transmittal.purpose]}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span>Issued {fmtDate(transmittal.issuedDate)}</span>
            <span>{METHOD_LABEL[transmittal.method]}</span>
            {transmittal.issuedByName && <span>by {transmittal.issuedByName}</span>}
            <span>· {transmittal.items.length} drawing{transmittal.items.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
              Edit
            </button>
            <button type="button" onClick={remove} disabled={busy} className="text-zinc-400 hover:text-red-500 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      {transmittal.items.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-100 dark:divide-zinc-800/70 dark:border-zinc-800">
          {transmittal.items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="font-mono font-medium text-zinc-700 dark:text-zinc-200">{i.drawingNumber}</span>
              {i.revision && <span className="text-zinc-500 dark:text-zinc-400">Rev {i.revision}</span>}
              {i.title && <span className="truncate text-zinc-500 dark:text-zinc-400">{i.title}</span>}
            </li>
          ))}
        </ul>
      )}

      {transmittal.notes && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{transmittal.notes}</p>}
    </div>
  );
}

/** The transmittals register: a record of which drawings were issued to whom, on
 *  what date, for what purpose. Managers issue and edit; everyone can view. */
export function TransmittalsRegister({
  projectId,
  transmittals,
  drawings,
  members,
  canManage,
}: {
  projectId: string;
  transmittals: Transmittal[];
  drawings: TransmittalDrawingOption[];
  members: TransmittalMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const memberOptions = useMemo(() => members, [members]);

  return (
    <div className="space-y-4">
      {canManage && !adding && (
        <Button size="sm" onClick={() => setAdding(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} />
            Issue a transmittal
          </span>
        </Button>
      )}

      {adding && (
        <Composer
          projectId={projectId}
          drawings={drawings}
          members={memberOptions}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {transmittals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <Send size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {canManage
              ? 'No transmittals yet. Issue one to record which drawings went to a recipient and when.'
              : 'No transmittals have been issued for this project yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {transmittals.map((t) => (
            <TransmittalCard key={t.id} transmittal={t} projectId={projectId} drawings={drawings} members={memberOptions} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
