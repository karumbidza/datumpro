/** Client-safe event types + labels. Kept out of the server-only `events.ts` so
 *  client components (the chat Events panel, the calendar) can import the label
 *  map and shapes without pulling a server module into the browser bundle. */

export type EventKind = 'meeting' | 'site_visit' | 'inspection' | 'other';

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  meeting: 'Meeting',
  site_visit: 'Site visit',
  inspection: 'Inspection',
  other: 'Event',
};

export interface EventAttendee {
  userId: string;
  name: string | null;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  title: string;
  detail: string | null;
  kind: EventKind;
  location: string | null;
  startsAt: string; // ISO
  endsAt: string | null;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
  createdBy: string | null;
  createdByName: string | null;
  attendees: EventAttendee[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  startsAt: string; // ISO
  status: 'scheduled' | 'cancelled';
  location: string | null;
}
