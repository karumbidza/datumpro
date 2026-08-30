import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { EventKind, ProjectEvent, CalendarEvent } from './events-types';

export type { EventKind, EventAttendee, ProjectEvent, CalendarEvent } from './events-types';
export { EVENT_KIND_LABEL } from './events-types';

type EventRow = {
  id: string;
  project_id: string;
  title: string;
  detail: string | null;
  kind: EventKind;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
  created_by: string | null;
};

const SELECT = 'id, project_id, title, detail, kind, location, starts_at, ends_at, notes, status, created_by';

async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Every event on a project (RLS scopes to members), each with its attendees.
 *  Soonest upcoming first is left to the caller — returned newest-created here. */
export async function listProjectEvents(projectId: string): Promise<ProjectEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_events')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('starts_at', { ascending: true });
  const rows = (data ?? []) as EventRow[];
  if (rows.length === 0) return [];

  const { data: attRows } = await supabase
    .from('event_attendees')
    .select('event_id, user_id')
    .in('event_id', rows.map((r) => r.id));
  const attendeesByEvent = new Map<string, string[]>();
  for (const a of (attRows ?? []) as { event_id: string; user_id: string }[]) {
    const arr = attendeesByEvent.get(a.event_id) ?? [];
    arr.push(a.user_id);
    attendeesByEvent.set(a.event_id, arr);
  }

  const names = await resolveNames(supabase, [
    ...rows.map((r) => r.created_by),
    ...(attRows ?? []).map((a: { user_id: string }) => a.user_id),
  ]);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    detail: r.detail,
    kind: r.kind,
    location: r.location,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    notes: r.notes,
    status: r.status,
    createdBy: r.created_by,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    attendees: (attendeesByEvent.get(r.id) ?? []).map((uid) => ({ userId: uid, name: names.get(uid) ?? null })),
  }));
}

/** What the calendar needs — events with their local start (bucketed client-side). */
export async function listCalendarEvents(projectId: string): Promise<CalendarEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_events')
    .select('id, title, kind, starts_at, status, location')
    .eq('project_id', projectId);
  return ((data ?? []) as {
    id: string;
    title: string;
    kind: EventKind;
    starts_at: string;
    status: 'scheduled' | 'cancelled';
    location: string | null;
  }[]).map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    startsAt: r.starts_at,
    status: r.status,
    location: r.location,
  }));
}
