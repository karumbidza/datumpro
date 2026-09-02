import { supabase } from '../supabase';

export type EventKind = 'meeting' | 'site_visit' | 'inspection' | 'other';

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  meeting: 'Meeting',
  site_visit: 'Site visit',
  inspection: 'Inspection',
  other: 'Event',
};

export interface EventAttendee {
  userId: string;
  name: string;
}

export interface ProjectEventDetail {
  id: string;
  projectId: string;
  title: string;
  detail: string | null;
  kind: EventKind;
  location: string | null;
  startsAt: string; // ISO
  endsAt: string | null; // ISO
  allDay: boolean;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
  organiserName: string | null;
  attendees: EventAttendee[];
}

/** One project event with its attendees and organiser name. RLS scopes it to
 *  project members / org staff; returns null when not found or not visible. */
export async function getProjectEvent(eventId: string): Promise<ProjectEventDetail | null> {
  const { data } = await supabase
    .from('project_events')
    .select('id, project_id, title, detail, kind, location, starts_at, ends_at, all_day, notes, status, created_by')
    .eq('id', eventId)
    .maybeSingle();
  if (!data) return null;
  const e = data as {
    id: string;
    project_id: string;
    title: string;
    detail: string | null;
    kind: EventKind;
    location: string | null;
    starts_at: string;
    ends_at: string | null;
    all_day: boolean;
    notes: string | null;
    status: 'scheduled' | 'cancelled';
    created_by: string | null;
  };

  const { data: attRows } = await supabase.from('event_attendees').select('user_id').eq('event_id', eventId);
  const attIds = ((attRows ?? []) as { user_id: string }[]).map((a) => a.user_id);

  const ids = [...new Set([e.created_by, ...attIds].filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
    for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
      names.set(p.id, p.display_name || p.email || 'Member');
    }
  }

  return {
    id: e.id,
    projectId: e.project_id,
    title: e.title,
    detail: e.detail,
    kind: e.kind,
    location: e.location,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    allDay: e.all_day,
    notes: e.notes,
    status: e.status,
    organiserName: e.created_by ? names.get(e.created_by) ?? null : null,
    attendees: attIds.map((uid) => ({ userId: uid, name: names.get(uid) ?? 'Member' })),
  };
}
