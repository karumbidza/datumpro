'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import { EVENT_KIND_LABEL, type ProjectEvent, type EventKind } from '@/lib/data/events';
import {
  createEvent,
  updateEvent,
  updateEventNotes,
  cancelEvent,
  deleteEvent,
  addAttendee,
  removeAttendee,
} from '@/app/(app)/projects/[projectId]/chat/event-actions';

export type EventMember = { userId: string; name: string };

const KINDS: EventKind[] = ['meeting', 'site_visit', 'inspection', 'other'];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Composer({
  projectId,
  conversationId,
  members,
  event,
  onDone,
  onCancel,
}: {
  projectId: string;
  conversationId: string;
  members: EventMember[];
  event?: ProjectEvent;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'meeting');
  const [when, setWhen] = useState(event ? toLocalInput(event.startsAt) : '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) return setError('Give the event a title.');
    if (!when) return setError('Pick a date and time.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('title', title.trim());
      fd.set('kind', kind);
      fd.set('startsAt', new Date(when).toISOString());
      if (location.trim()) fd.set('location', location.trim());
      let res;
      if (event) {
        fd.set('id', event.id);
        res = await updateEvent(fd);
      } else {
        fd.set('conversationId', conversationId);
        fd.set('attendeeIds', [...attendees].join(','));
        res = await createEvent(fd);
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
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" autoFocus className={inputClass} />
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className={`${inputClass} flex-1`}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputClass} flex-1`} />
      </div>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" className={inputClass} />
      {!event && members.length > 0 && (
        <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
          <p className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Invite</p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {members.map((m) => {
              const on = attendees.has(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => toggle(m.userId)}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    on
                      ? 'bg-brand-500 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : event ? 'Save' : 'Schedule'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function EventRow({
  event,
  projectId,
  members,
  canManage,
  currentUserId,
}: {
  event: ProjectEvent;
  projectId: string;
  members: EventMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(event.notes ?? '');
  const [busy, setBusy] = useState(false);
  const canEdit = canManage || event.createdBy === currentUserId;
  const cancelled = event.status === 'cancelled';
  const attendeeIds = new Set(event.attendees.map((a) => a.userId));
  const inviteable = members.filter((m) => !attendeeIds.has(m.userId));

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setBusy(true);
    await action(fd);
    setBusy(false);
    router.refresh();
  }
  const withEvent = (extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set('id', event.id);
    fd.set('projectId', projectId);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    return fd;
  };
  const attFd = (userId: string) => {
    const fd = new FormData();
    fd.set('eventId', event.id);
    fd.set('projectId', projectId);
    fd.set('userId', userId);
    return fd;
  };

  if (editing) {
    return (
      <li className="py-1">
        <Composer
          projectId={projectId}
          conversationId=""
          members={members}
          event={event}
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
    <li className="py-2">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-0.5 shrink-0">
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor">
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm font-medium ${cancelled ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>
              {event.title}
            </p>
            <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {EVENT_KIND_LABEL[event.kind]}
            </span>
            {cancelled && <span className="shrink-0 text-[10px] text-zinc-400">Cancelled</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span>{whenLabel(event.startsAt)}</span>
            {event.location && <span>{event.location}</span>}
            {event.attendees.length > 0 && <span>{event.attendees.length} attending</span>}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="ml-6 mt-2 space-y-3 border-l border-zinc-100 pl-3 dark:border-zinc-800">
          {event.detail && <p className="text-xs text-zinc-500 dark:text-zinc-400">{event.detail}</p>}

          <div>
            <p className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Attending</p>
            <div className="flex flex-wrap gap-1.5">
              {event.attendees.map((a) => (
                <span key={a.userId} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {a.name ?? 'Member'}
                  {canEdit && (
                    <button type="button" onClick={() => run(removeAttendee, attFd(a.userId))} disabled={busy} className="text-zinc-400 hover:text-red-500">
                      ×
                    </button>
                  )}
                </span>
              ))}
              {event.attendees.length === 0 && <span className="text-xs text-zinc-400 dark:text-zinc-500">No one yet</span>}
            </div>
            {canEdit && inviteable.length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && run(addAttendee, attFd(e.target.value))}
                disabled={busy}
                className={`${inputClass} mt-1.5`}
              >
                <option value="">+ Add someone…</option>
                {inviteable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Meeting notes / minutes */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Minutes, decisions, actions…"
              className={`${inputClass} resize-y`}
            />
            {notes !== (event.notes ?? '') && (
              <div className="mt-1.5">
                <Button size="sm" disabled={busy} onClick={() => run(updateEventNotes, withEvent({ notes }))}>
                  Save notes
                </Button>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-3 text-[11px]">
              <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
                Edit
              </button>
              {!cancelled && (
                <button type="button" onClick={() => run(cancelEvent, withEvent())} disabled={busy} className="text-zinc-500 hover:underline dark:text-zinc-400">
                  Cancel event
                </button>
              )}
              <button type="button" onClick={() => run(deleteEvent, withEvent())} disabled={busy} className="text-zinc-400 hover:text-red-500 hover:underline">
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Collapsible "Events" panel for the project chat — schedule meetings/site visits,
 *  invite people, and keep the minutes. Events also show on the calendar. */
export function ChatEvents({
  projectId,
  conversationId,
  events,
  members,
  canManage,
  currentUserId,
}: {
  projectId: string;
  conversationId: string;
  events: ProjectEvent[];
  members: EventMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const now = Date.now();
  const upcomingCount = events.filter((e) => e.status === 'scheduled' && new Date(e.startsAt).getTime() >= now).length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-medium">
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor">
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
          Events
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {upcomingCount} upcoming
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
          + Schedule
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
          {events.length === 0 ? (
            <p className="py-3 text-xs text-zinc-400 dark:text-zinc-500">
              No events yet. Schedule a meeting or site visit — it shows on the calendar, and you can keep the minutes here.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
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
