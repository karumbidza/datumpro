'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsd } from '@datumpro/shared/domain';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { FileEdit, Plus } from '@/components/icons';
import { STATUS_LABEL, type Variation, type VariationStatus, type VariationTotals } from '@/lib/data/variations-types';
import {
  createVariation,
  updateVariation,
  approveVariation,
  rejectVariation,
  deleteVariation,
} from '@/app/(app)/projects/[projectId]/variations/actions';

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';

const STATUS_STYLE: Record<VariationStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

function costLabel(cents: number): string {
  if (cents > 0) return `+${formatUsd(cents)}`;
  return formatUsd(cents); // formatUsd already renders the minus for credits
}
function timeLabel(days: number): string {
  if (days === 0) return 'no time impact';
  const n = Math.abs(days);
  return `${days > 0 ? '+' : '−'}${n} day${n === 1 ? '' : 's'}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Composer({
  projectId,
  variation,
  onDone,
  onCancel,
}: {
  projectId: string;
  variation?: Variation;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(variation?.description ?? '');
  const [reference, setReference] = useState(variation?.reference ?? '');
  const [cost, setCost] = useState(variation ? String(variation.costImpactCents / 100) : '');
  const [time, setTime] = useState(variation ? String(variation.timeImpactDays) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 2) return setError('Describe the change.');
    const costCents = Math.round(parseFloat(cost || '0') * 100);
    const timeDays = Math.round(parseFloat(time || '0'));
    if (!Number.isFinite(costCents)) return setError('Enter a valid cost impact.');
    if (!Number.isFinite(timeDays)) return setError('Enter a valid time impact.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('description', description.trim());
      fd.set('reference', reference.trim());
      fd.set('costImpactCents', String(costCents));
      fd.set('timeImpactDays', String(timeDays));
      let res;
      if (variation) {
        fd.set('id', variation.id);
        res = await updateVariation(fd);
      } else {
        res = await createVariation(fd);
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
        <span className={fieldLabel}>Change described</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} autoFocus placeholder="e.g. Add waterproofing to the basement retaining wall" className={`${inputClass} resize-y`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>Reference (optional)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. CE-014" className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Cost impact ($)</span>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="12400 or -800" className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Time impact (days)</span>
          <input type="number" step="1" value={time} onChange={(e) => setTime(e.target.value)} placeholder="5" className={inputClass} />
        </label>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">A credit or time saving can be entered as a negative number.</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : variation ? 'Save' : 'Raise variation'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function VariationCard({
  variation,
  projectId,
  canModerate,
}: {
  variation: Variation;
  projectId: string;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitted = variation.status === 'submitted';

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', variation.id);
    fd.set('projectId', projectId);
    await action(fd);
    setBusy(false);
    router.refresh();
  }

  if (editing) {
    return (
      <Composer
        projectId={projectId}
        variation={variation}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const cost = variation.costImpactCents;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">VO #{variation.number}</span>
            {variation.reference && <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{variation.reference}</span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[variation.status]}`}>{STATUS_LABEL[variation.status]}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{variation.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span className={cost > 0 ? 'font-medium text-zinc-700 dark:text-zinc-200' : cost < 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : ''}>
              {costLabel(cost)}
            </span>
            <span>{timeLabel(variation.timeImpactDays)}</span>
            <span>Raised by {variation.createdByName ?? 'Member'}</span>
            {variation.status === 'approved' && variation.approvedByName && (
              <span>Approved by {variation.approvedByName}{variation.approvedAt ? ` · ${fmtDate(variation.approvedAt)}` : ''}</span>
            )}
            {variation.status === 'rejected' && variation.decidedAt && <span>Rejected {fmtDate(variation.decidedAt)}</span>}
          </div>
        </div>
        {canModerate && (
          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            {(variation.status === 'draft' || submitted) && (
              <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
                Edit
              </button>
            )}
            <button type="button" onClick={() => run(deleteVariation)} disabled={busy} className="text-zinc-400 hover:text-red-500 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      {canModerate && submitted && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
          <Button size="sm" disabled={busy} onClick={() => run(approveVariation)}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(rejectVariation)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

type Filter = 'open' | 'decided' | 'all';

/** The variations register: log a scope change with its cost & time impact, get
 *  it approved or rejected, and track the running contract impact. */
export function VariationsRegister({
  projectId,
  variations,
  totals,
  canModerate,
}: {
  projectId: string;
  variations: Variation[];
  totals: VariationTotals;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const shown = useMemo(() => {
    if (filter === 'all') return variations;
    if (filter === 'open') return variations.filter((v) => v.status === 'draft' || v.status === 'submitted');
    return variations.filter((v) => v.status === 'approved' || v.status === 'rejected');
  }, [variations, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'open', label: `Open${totals.pendingCount ? ` ${totals.pendingCount}` : ''}` },
    { key: 'decided', label: 'Decided' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      {/* Contract-impact totals */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-zinc-500 dark:text-zinc-400">
          Approved to date{' '}
          <strong className={totals.approvedCostCents < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-white'}>
            {costLabel(totals.approvedCostCents)}
          </strong>
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          Time <strong className="text-zinc-900 dark:text-white">{timeLabel(totals.approvedTimeDays)}</strong>
        </span>
        {totals.pendingCount > 0 && (
          <span className="text-amber-700 dark:text-amber-300">
            {totals.pendingCount} awaiting a decision
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {adding ? null : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={15} />
              Raise a variation
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
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {variations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <FileEdit size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            No variations yet. Raise one when the scope changes — its cost and time impact go up for approval.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">Nothing here — try another filter.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((v) => (
            <VariationCard key={v.id} variation={v} projectId={projectId} canModerate={canModerate} />
          ))}
        </div>
      )}
    </div>
  );
}
