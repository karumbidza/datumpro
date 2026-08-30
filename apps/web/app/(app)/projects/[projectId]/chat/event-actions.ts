'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/chat`);
  revalidatePath(`/projects/${projectId}/calendar`);
}

function niceWhen(startsAt: string): string {
  return new Date(startsAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function actorName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('display_name, email').eq('id', userId).maybeSingle();
  const p = data as { display_name: string | null; email: string | null } | null;
  return p?.display_name || p?.email?.split('@')[0] || 'someone';
}

/** Schedule a meeting or site visit from chat. Attendees (comma-separated ids) are
 *  added and notified; the organiser is added too. */
export async function createEvent(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'meeting');
  const startsAt = String(formData.get('startsAt') ?? '');
  const endsAt = (formData.get('endsAt') as string) || null;
  const location = (formData.get('location') as string)?.trim() || null;
  const detail = (formData.get('detail') as string)?.trim() || null;
  const conversationId = (formData.get('conversationId') as string) || null;
  const attendeeIds = String(formData.get('attendeeIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (title.length < 2) return { ok: false, error: 'Give the event a title.' };
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { ok: false, error: 'Pick a start date and time.' };
  if (!['meeting', 'site_visit', 'inspection', 'other'].includes(kind)) return { ok: false, error: 'Invalid type.' };

  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string; name: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('project_events')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      conversation_id: conversationId,
      title,
      detail,
      kind,
      location,
      starts_at: startsAt,
      ends_at: endsAt,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  const eventId = (inserted as { id: string }).id;

  const attendees = [...new Set([user.id, ...attendeeIds])];
  if (attendees.length) {
    await supabase.from('event_attendees').insert(
      attendees.map((uid) => ({
        event_id: eventId,
        org_id: project.org_id,
        project_id: projectId,
        user_id: uid,
        added_by: user.id,
      })),
    );
  }

  const by = await actorName(supabase, user.id);
  await Promise.all(
    attendeeIds
      .filter((uid) => uid !== user.id)
      .map((uid) =>
        notifyUser(supabase, {
          orgId: project.org_id,
          userId: uid,
          type: 'event_invite',
          title: `${by} scheduled ${title} — ${project.name}`,
          body: `${niceWhen(startsAt)}${location ? ` · ${location}` : ''}`,
          link: `/projects/${projectId}/calendar`,
          entityId: eventId,
        }),
      ),
  );

  revalidate(projectId);
  return { ok: true };
}

/** Edit an event's core details. */
export async function updateEvent(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'meeting');
  const startsAt = String(formData.get('startsAt') ?? '');
  const endsAt = (formData.get('endsAt') as string) || null;
  const location = (formData.get('location') as string)?.trim() || null;
  const detail = (formData.get('detail') as string)?.trim() || null;
  if (!id || !projectId) return { ok: false, error: 'Missing event.' };
  if (title.length < 2) return { ok: false, error: 'Give the event a title.' };
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { ok: false, error: 'Pick a start date and time.' };

  const { error } = await supabase
    .from('project_events')
    .update({ title, kind, starts_at: startsAt, ends_at: endsAt, location, detail, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

/** Save meeting notes (minutes). Attendees may. */
export async function updateEventNotes(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const notes = (formData.get('notes') as string) ?? '';
  if (!id || !projectId) return { ok: false, error: 'Missing event.' };

  const { error } = await supabase
    .from('project_events')
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

/** Cancel (keep on the calendar, struck through) or remove an event. */
export async function cancelEvent(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing event.' };
  const { error } = await supabase
    .from('project_events')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteEvent(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing event.' };
  const { error } = await supabase.from('project_events').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

/** Add someone to an event and notify them. */
export async function addAttendee(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const eventId = String(formData.get('eventId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!eventId || !projectId || !userId) return { ok: false, error: 'Missing details.' };

  const { data: ev } = await supabase
    .from('project_events')
    .select('org_id, title, starts_at, location')
    .eq('id', eventId)
    .maybeSingle();
  const e = ev as { org_id: string; title: string; starts_at: string; location: string | null } | null;
  if (!e) return { ok: false, error: 'Event not found.' };

  const { error } = await supabase
    .from('event_attendees')
    .insert({ event_id: eventId, org_id: e.org_id, project_id: projectId, user_id: userId, added_by: user.id });
  if (error) return { ok: false, error: error.message };

  if (userId !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    const name = (proj as { name: string } | null)?.name ?? 'a project';
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: e.org_id,
      userId,
      type: 'event_invite',
      title: `${by} added you to ${e.title} — ${name}`,
      body: `${niceWhen(e.starts_at)}${e.location ? ` · ${e.location}` : ''}`,
      link: `/projects/${projectId}/calendar`,
      entityId: eventId,
    });
  }
  revalidate(projectId);
  return { ok: true };
}

export async function removeAttendee(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const eventId = String(formData.get('eventId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!eventId || !projectId || !userId) return { ok: false, error: 'Missing details.' };
  const { error } = await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
