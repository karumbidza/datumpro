'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notifyProjectManagers } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

async function actorName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('display_name, email').eq('id', userId).maybeSingle();
  const p = data as { display_name: string | null; email: string | null } | null;
  return p?.display_name || p?.email?.split('@')[0] || 'someone';
}

/** A whole-number field or null (blank → null, negatives clamped out). */
function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function text(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/** Create or update the diary entry for a given day (one per project per day).
 *  A brand-new entry pings the project's PMs. */
export async function saveSiteDiaryEntry(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get('projectId') ?? '');
  const entryDate = String(formData.get('entryDate') ?? '').trim();
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (!entryDate || Number.isNaN(Date.parse(entryDate))) return { ok: false, error: 'Pick a date.' };

  const fields = {
    weather: text(formData.get('weather')),
    temperature: intOrNull(formData.get('temperature')),
    labour_count: intOrNull(formData.get('labourCount')),
    plant: text(formData.get('plant')),
    deliveries: text(formData.get('deliveries')),
    notes: text(formData.get('notes')),
    hse_incidents: intOrNull(formData.get('hseIncidents')),
    hse_near_misses: intOrNull(formData.get('hseNearMisses')),
    hse_toolbox_talk: text(formData.get('hseToolboxTalk')),
    hse_notes: text(formData.get('hseNotes')),
  };
  // Don't create an empty shell — require at least one filled field.
  if (Object.values(fields).every((v) => v === null)) {
    return { ok: false, error: 'Add at least one detail before saving.' };
  }

  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string; name: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: existing } = await supabase
    .from('site_diary_entries')
    .select('id')
    .eq('project_id', projectId)
    .eq('entry_date', entryDate)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('site_diary_entries')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: inserted, error } = await supabase
      .from('site_diary_entries')
      .insert({ org_id: project.org_id, project_id: projectId, entry_date: entryDate, ...fields, created_by: user.id })
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };

    const by = await actorName(supabase, user.id);
    const when = new Date(`${entryDate}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    await notifyProjectManagers(supabase, {
      orgId: project.org_id,
      projectId,
      type: 'site_diary',
      title: `${by} logged the site diary — ${project.name}`,
      body: when,
      link: `/projects/${projectId}/diary`,
      entityId: (inserted as { id: string }).id,
    });
  }

  revalidatePath(`/projects/${projectId}/diary`);
  return { ok: true };
}

/** Record a photo already uploaded to the project-media bucket against an entry. */
export async function recordSiteDiaryPhoto(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();

  const entryId = String(formData.get('entryId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const storagePath = String(formData.get('storagePath') ?? '');
  const caption = text(formData.get('caption'));
  if (!entryId || !projectId || !storagePath) return { ok: false, error: 'Missing photo.' };

  const { data: entry } = await supabase
    .from('site_diary_entries')
    .select('org_id')
    .eq('id', entryId)
    .maybeSingle();
  const e = entry as { org_id: string } | null;
  if (!e) return { ok: false, error: 'Diary entry not found.' };

  const { error } = await supabase.from('site_diary_photos').insert({
    entry_id: entryId,
    org_id: e.org_id,
    project_id: projectId,
    storage_path: storagePath,
    caption,
    uploaded_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/diary`);
  return { ok: true };
}

export async function deleteSiteDiaryPhoto(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const photoId = String(formData.get('photoId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!photoId || !projectId) return { ok: false, error: 'Missing photo.' };
  const { error } = await supabase.from('site_diary_photos').delete().eq('id', photoId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/diary`);
  return { ok: true };
}

export async function deleteSiteDiaryEntry(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing entry.' };
  const { error } = await supabase.from('site_diary_entries').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/diary`);
  return { ok: true };
}
