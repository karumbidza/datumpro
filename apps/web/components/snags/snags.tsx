'use client';

import { useState, useMemo, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { fmtMoney } from '@/lib/money';
import { ImageIcon, ShieldAlert, AlertTriangle, Plus, Clock } from '@/components/icons';
import {
  SEVERITY_LABEL,
  STATUS_LABEL,
  type Snag,
  type SnagPhoto,
  type SnagSeverity,
  type SnagStatus,
  type ProjectDlp,
  type SnagContractor,
} from '@/lib/data/snags-types';
import {
  raiseSnag,
  updateSnag,
  markSnagFixed,
  verifySnag,
  reopenSnag,
  deductSnagFromRetention,
  recordSnagPhoto,
  deleteSnagPhoto,
  deleteSnag,
} from '@/app/(app)/projects/[projectId]/snags/actions';

const BUCKET = 'project-media';
const SEVERITIES: SnagSeverity[] = ['minor', 'major', 'critical'];

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';

const SEVERITY_STYLE: Record<SnagSeverity, string> = {
  minor: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  major: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};
const STATUS_STYLE: Record<SnagStatus, string> = {
  open: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  fixed: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  verified: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  reopened: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  charged: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function isOverdue(dueDate: string | null, status: SnagStatus): boolean {
  if (!dueDate || status === 'verified' || status === 'charged') return false;
  return new Date(`${dueDate}T23:59:59`).getTime() < Date.now();
}

function Composer({
  projectId,
  contractors,
  snag,
  onDone,
  onCancel,
}: {
  projectId: string;
  contractors: SnagContractor[];
  snag?: Snag;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(snag?.title ?? '');
  const [severity, setSeverity] = useState<SnagSeverity>(snag?.severity ?? 'major');
  const [location, setLocation] = useState(snag?.location ?? '');
  const [description, setDescription] = useState(snag?.description ?? '');
  const [assigneeId, setAssigneeId] = useState(snag?.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(snag?.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) return setError('Give the defect a short title.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('title', title.trim());
      fd.set('severity', severity);
      fd.set('location', location.trim());
      fd.set('description', description.trim());
      fd.set('assigneeId', assigneeId);
      fd.set('dueDate', dueDate);
      let res;
      if (snag) {
        fd.set('id', snag.id);
        res = await updateSnag(fd);
      } else {
        res = await raiseSnag(fd);
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
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <label className="block">
        <span className={fieldLabel}>Defect</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Grout cracking to tiling"
          autoFocus
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as SnagSeverity)} className={inputClass}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Unit 3 bathroom"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Assign to</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">Unassigned</option>
            {contractors.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Detail</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What's wrong, and what good looks like…"
          className={`${inputClass} resize-y`}
        />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : snag ? 'Save' : 'Raise snag'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeductForm({
  snag,
  contractor,
  onDone,
  onCancel,
}: {
  snag: Snag;
  contractor: SnagContractor | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = contractor?.availableRetentionCents ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a valid amount.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('id', snag.id);
      fd.set('projectId', snag.projectId);
      fd.set('amountCents', String(cents));
      const res = await deductSnagFromRetention(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not charge retention');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not charge retention');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-500/30 dark:bg-purple-500/10">
      <p className="text-xs text-purple-800 dark:text-purple-200">
        Charge the repair against {snag.assigneeName ?? 'the contractor'}&apos;s retention. This records an immutable
        deduction and closes the snag.
        {available != null && (
          <>
            {' '}
            Available: <span className="font-medium">{fmtMoney(available, 'USD', 2)}</span>.
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          autoFocus
          className={`${inputClass} max-w-[8rem]`}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Charging…' : 'Charge retention'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}

function PhotoUploader({ snagId, projectId, orgId }: { snagId: string; projectId: string; orgId: string }) {
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
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
      // Segment [2] is the project → existing project-media storage policy authorises it.
      const path = `${orgId}/${projectId}/snags/${snagId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const fd = new FormData();
      fd.set('snagId', snagId);
      fd.set('projectId', projectId);
      fd.set('storagePath', path);
      const res = await recordSnagPhoto(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not attach photo');
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
      <label
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
          busy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <input type="file" accept="image/*" className="hidden" onChange={onChange} disabled={busy} />
        <ImageIcon size={14} />
        {busy ? 'Uploading…' : 'Add photo'}
      </label>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PhotoGrid({ photos, projectId, canEdit }: { photos: SnagPhoto[]; projectId: string; canEdit: boolean }) {
  const router = useRouter();
  if (photos.length === 0) return null;
  async function remove(photoId: string) {
    const fd = new FormData();
    fd.set('photoId', photoId);
    fd.set('projectId', projectId);
    await deleteSnagPhoto(fd);
    router.refresh();
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {photos.map((p) => (
        <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? 'Snag photo'} className="h-full w-full object-cover" />
            </a>
          ) : (
            <div className="grid h-full w-full place-items-center text-zinc-400">
              <ImageIcon size={20} />
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => remove(p.id)}
              aria-label="Remove photo"
              className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-black/60 text-white group-hover:grid"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SnagCard({
  snag,
  projectId,
  orgId,
  contractors,
  canModerate,
  currentUserId,
}: {
  snag: Snag;
  projectId: string;
  orgId: string;
  contractors: SnagContractor[];
  canModerate: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deducting, setDeducting] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAssignee = snag.assigneeId === currentUserId;
  const canEdit = canModerate || snag.raisedBy === currentUserId;
  const overdue = isOverdue(snag.dueDate, snag.status);

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', snag.id);
    fd.set('projectId', projectId);
    await action(fd);
    setBusy(false);
    router.refresh();
  }

  if (editing) {
    return (
      <Composer
        projectId={projectId}
        contractors={contractors}
        snag={snag}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const canMarkFixed = (isAssignee || canModerate) && (snag.status === 'open' || snag.status === 'reopened');
  const canVerify = canModerate && snag.status === 'fixed';
  const canReopen = canModerate && (snag.status === 'fixed' || snag.status === 'verified');
  const canCharge =
    canModerate && !!snag.assigneeId && snag.status !== 'charged' && snag.status !== 'verified';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">#{snag.number}</span>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{snag.title}</h3>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLE[snag.severity]}`}>
              {SEVERITY_LABEL[snag.severity]}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[snag.status]}`}>
              {STATUS_LABEL[snag.status]}
            </span>
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                <Clock size={11} /> Overdue
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {snag.location && <span>{snag.location}</span>}
            <span>{snag.assigneeName ? `Assigned: ${snag.assigneeName}` : 'Unassigned'}</span>
            {snag.dueDate && <span>Due {fmtDate(snag.dueDate)}</span>}
            <span>Raised by {snag.raisedByName ?? 'Member'}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
              Edit
            </button>
            <button type="button" onClick={() => run(deleteSnag)} disabled={busy} className="text-zinc-400 hover:text-red-500 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      {snag.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{snag.description}</p>
      )}

      {snag.status === 'charged' && snag.deductionAmountCents != null && (
        <p className="mt-2 rounded-md bg-purple-50 px-2 py-1 text-xs text-purple-800 dark:bg-purple-500/10 dark:text-purple-200">
          Charged to retention: {fmtMoney(snag.deductionAmountCents, 'USD', 2)}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <PhotoGrid photos={snag.photos} projectId={projectId} canEdit={canEdit} />
        {(canEdit || isAssignee) && <PhotoUploader snagId={snag.id} projectId={projectId} orgId={orgId} />}
      </div>

      {(canMarkFixed || canVerify || canReopen || canCharge) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
          {canMarkFixed && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(markSnagFixed)}>
              Mark fixed
            </Button>
          )}
          {canVerify && (
            <Button size="sm" disabled={busy} onClick={() => run(verifySnag)}>
              Verify fix
            </Button>
          )}
          {canReopen && (
            <button type="button" onClick={() => run(reopenSnag)} disabled={busy} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
              Reopen
            </button>
          )}
          {canCharge && !deducting && (
            <button
              type="button"
              onClick={() => setDeducting(true)}
              disabled={busy}
              className="text-xs font-medium text-purple-600 hover:underline dark:text-purple-300"
            >
              Charge to retention
            </button>
          )}
        </div>
      )}

      {deducting && (
        <DeductForm
          snag={snag}
          contractor={contractors.find((c) => c.userId === snag.assigneeId)}
          onDone={() => {
            setDeducting(false);
            router.refresh();
          }}
          onCancel={() => setDeducting(false)}
        />
      )}
    </div>
  );
}

type Filter = 'open' | 'closed' | 'all';

/** The snagging / defects register: raise a defect, assign a contractor, track it
 *  to a verified fix — or, during the defects-liability period, charge the repair
 *  against the contractor's retention. */
export function SnagsRegister({
  projectId,
  orgId,
  snags,
  dlp,
  contractors,
  canModerate,
  currentUserId,
}: {
  projectId: string;
  orgId: string;
  snags: Snag[];
  dlp: ProjectDlp;
  contractors: SnagContractor[];
  canModerate: boolean;
  currentUserId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const router = useRouter();

  const openCount = snags.filter((s) => s.status !== 'verified' && s.status !== 'charged').length;
  const shown = useMemo(() => {
    if (filter === 'all') return snags;
    if (filter === 'open') return snags.filter((s) => s.status !== 'verified' && s.status !== 'charged');
    return snags.filter((s) => s.status === 'verified' || s.status === 'charged');
  }, [snags, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'open', label: `Open${openCount ? ` ${openCount}` : ''}` },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      {dlp.inDlp && dlp.releaseAt && (
        <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            Within the defects-liability period (ends {fmtDate(dlp.releaseAt)}). Defects raised now are the contractor&apos;s
            to put right; unresolved ones can be charged against their retention.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {adding ? null : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={15} />
              Raise a snag
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
                filter === f.key
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
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
          contractors={contractors}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {snags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <AlertTriangle size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            No defects logged. Raise the first snag — assign it to a contractor and track it through to a verified fix.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">Nothing here — try another filter.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((snag) => (
            <SnagCard
              key={snag.id}
              snag={snag}
              projectId={projectId}
              orgId={orgId}
              contractors={contractors}
              canModerate={canModerate}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
