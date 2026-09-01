'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import type { ActionItem, Urgency } from '@/lib/data/action-items';
import {
  createActionItem,
  setActionItemDone,
  updateActionItem,
  deleteActionItem,
} from '@/app/(app)/projects/[projectId]/chat/action-item-actions';

export type ActionMember = { userId: string; name: string };

/** Urgency → picker label + chip tone. 'normal' shows no chip (the quiet default). */
const URGENCY_META: Record<Urgency, { label: string; chip: string | null }> = {
  urgent: { label: 'Urgent', chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  high: { label: 'High', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  normal: { label: 'Normal', chip: null },
  low: { label: 'Low', chip: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
};
const URGENCY_ORDER: Urgency[] = ['low', 'normal', 'high', 'urgent'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDue(iso: string): string {
  const [, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${mon} ${Number(d)}`;
}

/** The form used for both new and edit. */
function Composer({
  projectId,
  conversationId,
  members,
  item,
  onDone,
  onCancel,
}: {
  projectId: string;
  conversationId: string;
  members: ActionMember[];
  item?: ActionItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [assignee, setAssignee] = useState(item?.assigneeId ?? '');
  const [due, setDue] = useState(item?.dueDate ?? '');
  const [urgency, setUrgency] = useState<Urgency>(item?.urgency ?? 'normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) return setError('Give the to-do a title.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('title', title.trim());
      if (assignee) fd.set('assigneeId', assignee);
      if (due) fd.set('dueDate', due);
      fd.set('urgency', urgency);
      let res;
      if (item) {
        fd.set('id', item.id);
        res = await updateActionItem(fd);
      } else {
        fd.set('conversationId', conversationId);
        res = await createActionItem(fd);
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
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing?"
        autoFocus
        className={inputClass}
      />
      <div className="flex flex-wrap gap-2">
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${inputClass} flex-1`}>
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <input type="date" value={due} min={todayIso()} onChange={(e) => setDue(e.target.value)} className={`${inputClass} flex-1`} />
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as Urgency)}
          aria-label="Urgency"
          className={`${inputClass} flex-1`}
        >
          {URGENCY_ORDER.map((u) => (
            <option key={u} value={u}>
              {URGENCY_META[u].label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save' : 'Add to-do'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({
  item,
  projectId,
  members,
  canManage,
  currentUserId,
}: {
  item: ActionItem;
  projectId: string;
  members: ActionMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = item.status === 'done';
  const overdue = !done && item.dueDate != null && item.dueDate < todayIso();
  const canEdit = canManage || item.createdBy === currentUserId;
  const isAssignee = item.assigneeId === currentUserId;
  // Only the assignee (or a manager) may TICK OFF an assigned to-do; anyone with
  // edit rights, plus the assignee, may reopen it. Mirrors the DB completion guard.
  const canComplete = !item.assigneeId || isAssignee || canManage;
  const canReopen = canEdit || isAssignee;
  const checkboxEnabled = done ? canReopen : canComplete;
  const blockedReason =
    !done && !canComplete ? `Only ${item.assigneeName ?? 'the assignee'} can complete this` : undefined;
  const urgency = URGENCY_META[item.urgency];

  async function toggle() {
    if (!checkboxEnabled) return;
    setBusy(true);
    const fd = new FormData();
    fd.set('id', item.id);
    fd.set('projectId', projectId);
    fd.set('done', String(!done));
    await setActionItemDone(fd);
    setBusy(false);
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', item.id);
    fd.set('projectId', projectId);
    await deleteActionItem(fd);
    setBusy(false);
    router.refresh();
  }

  if (editing) {
    return (
      <li className="py-1">
        <Composer
          projectId={projectId}
          conversationId=""
          members={members}
          item={item}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2.5 py-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !checkboxEnabled}
        aria-label={done ? 'Reopen' : 'Mark done'}
        title={blockedReason}
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          done
            ? 'border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500'
            : 'border-zinc-300 hover:border-green-500 dark:border-zinc-600'
        } ${!checkboxEnabled ? 'cursor-not-allowed opacity-50 hover:border-zinc-300 dark:hover:border-zinc-600' : ''}`}
      >
        {done ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-100'}`}>
          {item.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          {!done && urgency.chip && (
            <span className={`rounded-full px-1.5 py-0.5 font-medium ${urgency.chip}`}>{urgency.label}</span>
          )}
          <span>{item.assigneeName ? `For ${item.assigneeName}` : 'Unassigned'}</span>
          {item.dueDate && (
            <span className={overdue ? 'font-medium text-red-500' : ''}>Due {fmtDue(item.dueDate)}</span>
          )}
        </div>
      </div>
      {canEdit && !done && (
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-600 hover:underline dark:hover:text-zinc-300">
          Edit
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={remove} disabled={busy} className="shrink-0 text-[11px] text-zinc-400 hover:text-red-500 hover:underline">
          Remove
        </button>
      )}
    </li>
  );
}

/** Collapsible "To-dos" panel for the project chat — raise a lightweight action
 *  item (assignee + deadline), see what's open, and tick it off. Distinct from
 *  formal tasks; deadlines also show on the project calendar. */
export function ChatActionItems({
  projectId,
  conversationId,
  items,
  members,
  canManage,
  currentUserId,
}: {
  projectId: string;
  conversationId: string;
  items: ActionItem[];
  members: ActionMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const openCount = items.filter((i) => i.status === 'open').length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-medium">
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor">
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
          To-dos
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {openCount} open
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setAdding(true);
          }}
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          + New to-do
        </button>
      </div>

      {open && (
        <div className="border-t border-zinc-100 px-3.5 py-2 dark:border-zinc-800/70">
          {adding && (
            <div className="py-2">
              <Composer
                projectId={projectId}
                conversationId={conversationId}
                members={members}
                onDone={() => {
                  setAdding(false);
                  router.refresh();
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}
          {items.length === 0 ? (
            <p className="py-3 text-xs text-zinc-400 dark:text-zinc-500">
              No to-dos yet. Raise one to give someone a quick task with a deadline — it shows on the calendar.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  projectId={projectId}
                  members={members}
                  canManage={canManage}
                  currentUserId={currentUserId}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
