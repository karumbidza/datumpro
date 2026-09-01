import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';

const BUCKET = 'project-media';

export interface DiaryPhoto {
  id: string;
  url: string | null;
  caption: string | null;
}

export interface SiteDiaryEntry {
  id: string;
  projectId: string;
  entryDate: string; // YYYY-MM-DD
  weather: string | null;
  temperature: number | null;
  labourCount: number | null;
  plant: string | null;
  deliveries: string | null;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
  photos: DiaryPhoto[];
}

type EntryRow = {
  id: string;
  project_id: string;
  entry_date: string;
  weather: string | null;
  temperature: number | null;
  labour_count: number | null;
  plant: string | null;
  deliveries: string | null;
  notes: string | null;
  created_by: string | null;
};

const SELECT =
  'id, project_id, entry_date, weather, temperature, labour_count, plant, deliveries, notes, created_by';

async function resolveNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Every diary entry on a project (most recent date first), photos signed for an hour. */
export async function listSiteDiaryEntries(projectId: string): Promise<SiteDiaryEntry[]> {
  const { data } = await supabase
    .from('site_diary_entries')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('entry_date', { ascending: false });
  const rows = (data ?? []) as EntryRow[];
  if (rows.length === 0) return [];

  const { data: photoRows } = await supabase
    .from('site_diary_photos')
    .select('id, entry_id, storage_path, caption')
    .in(
      'entry_id',
      rows.map((r) => r.id),
    )
    .order('created_at', { ascending: true });
  const photos = (photoRows ?? []) as { id: string; entry_id: string; storage_path: string; caption: string | null }[];

  const signed = new Map<string, string>();
  if (photos.length) {
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(
      photos.map((p) => p.storage_path),
      60 * 60,
    );
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }
  const byEntry = new Map<string, DiaryPhoto[]>();
  for (const p of photos) {
    const arr = byEntry.get(p.entry_id) ?? [];
    arr.push({ id: p.id, url: signed.get(p.storage_path) ?? null, caption: p.caption });
    byEntry.set(p.entry_id, arr);
  }

  const names = await resolveNames(rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    entryDate: r.entry_date,
    weather: r.weather,
    temperature: r.temperature,
    labourCount: r.labour_count,
    plant: r.plant,
    deliveries: r.deliveries,
    notes: r.notes,
    createdById: r.created_by,
    createdByName: r.created_by ? names.get(r.created_by) ?? null : null,
    photos: byEntry.get(r.id) ?? [],
  }));
}

async function projectOrg(projectId: string): Promise<string | null> {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** owner/admin/pm — for edit/delete affordances (also enforced by RLS). */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const orgId = await projectOrg(projectId);
  if (!orgId) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

export interface DiaryFields {
  weather: string | null;
  temperature: number | null;
  labourCount: number | null;
  plant: string | null;
  deliveries: string | null;
  notes: string | null;
}

/** Upsert one entry per (project, date). Requires at least one filled field.
 *  Returns the entry id so photos can be attached. */
export async function saveSiteDiaryEntry(projectId: string, entryDate: string, fields: DiaryFields): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  if (!entryDate) throw new Error('Pick a date.');
  const row = {
    weather: fields.weather?.trim() || null,
    temperature: fields.temperature,
    labour_count: fields.labourCount,
    plant: fields.plant?.trim() || null,
    deliveries: fields.deliveries?.trim() || null,
    notes: fields.notes?.trim() || null,
  };
  if (Object.values(row).every((v) => v === null)) throw new Error('Add at least one detail before saving.');

  const orgId = await projectOrg(projectId);
  if (!orgId) throw new Error('Project not found.');

  const { data: existing } = await supabase
    .from('site_diary_entries')
    .select('id')
    .eq('project_id', projectId)
    .eq('entry_date', entryDate)
    .maybeSingle();

  if (existing) {
    const id = (existing as { id: string }).id;
    const { error } = await supabase
      .from('site_diary_entries')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return id;
  }
  const { data: inserted, error } = await supabase
    .from('site_diary_entries')
    .insert({ org_id: orgId, project_id: projectId, entry_date: entryDate, ...row, created_by: user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (inserted as { id: string }).id;
}

export async function deleteSiteDiaryEntry(id: string): Promise<void> {
  const { error } = await supabase.from('site_diary_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Upload a captured photo to project-media and record it against the entry. */
export async function addDiaryPhoto(params: {
  entryId: string;
  projectId: string;
  base64: string;
  ext: string;
  mime: string;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const orgId = await projectOrg(params.projectId);
  if (!orgId) throw new Error('Project not found.');

  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${params.ext}`;
  const path = `${orgId}/${params.projectId}/diary/${params.entryId}/${name}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from('site_diary_photos').insert({
    entry_id: params.entryId,
    org_id: orgId,
    project_id: params.projectId,
    storage_path: path,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message);
}

export async function deleteDiaryPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.from('site_diary_photos').delete().eq('id', photoId);
  if (error) throw new Error(error.message);
}
