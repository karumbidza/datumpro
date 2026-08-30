import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SiteDiaryEntry, DiaryPhoto } from './site-diary-types';

export type { SiteDiaryEntry, DiaryPhoto } from './site-diary-types';

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
  created_at: string;
  updated_at: string;
};

type PhotoRow = {
  id: string;
  entry_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
};

const ENTRY_SELECT =
  'id, project_id, entry_date, weather, temperature, labour_count, plant, deliveries, notes, created_by, created_at, updated_at';

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

/** Every diary entry on a project (RLS scopes to members), newest day first,
 *  each with its photos (signed for an hour) and the author's name. */
export async function listSiteDiaryEntries(projectId: string): Promise<SiteDiaryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_diary_entries')
    .select(ENTRY_SELECT)
    .eq('project_id', projectId)
    .order('entry_date', { ascending: false });
  const rows = (data ?? []) as EntryRow[];
  if (rows.length === 0) return [];

  const { data: photoRows } = await supabase
    .from('site_diary_photos')
    .select('id, entry_id, storage_path, caption, uploaded_by')
    .in('entry_id', rows.map((r) => r.id))
    .order('created_at', { ascending: true });
  const photos = (photoRows ?? []) as PhotoRow[];

  // One batched sign for every photo path across all entries.
  const signed = new Map<string, string>();
  if (photos.length) {
    const paths = photos.map((p) => p.storage_path);
    const { data: urls } = await supabase.storage.from('project-media').createSignedUrls(paths, 60 * 60);
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const photosByEntry = new Map<string, DiaryPhoto[]>();
  for (const p of photos) {
    const arr = photosByEntry.get(p.entry_id) ?? [];
    arr.push({ id: p.id, url: signed.get(p.storage_path) ?? null, caption: p.caption, uploadedBy: p.uploaded_by });
    photosByEntry.set(p.entry_id, arr);
  }

  const names = await resolveNames(supabase, rows.map((r) => r.created_by));

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
    createdBy: r.created_by,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    photos: photosByEntry.get(r.id) ?? [],
  }));
}
