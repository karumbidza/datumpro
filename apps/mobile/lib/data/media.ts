import { decode } from 'base64-arraybuffer';
import { supabase, currentUser} from '../supabase';

const BUCKET = 'project-media';

export interface TaskPhoto {
  id: string;
  url: string | null; // short-lived signed URL
  caption: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

/** Completion/site photos already on a task, newest first, with signed URLs.
 *  The bucket is private, so URLs are minted per request (SELECT RLS gates it). */
export async function listTaskPhotos(taskId: string): Promise<TaskPhoto[]> {
  const { data } = await supabase
    .from('task_media')
    .select('id, storage_path, caption, gps_lat, gps_lng')
    .eq('task_id', taskId)
    .eq('kind', 'photo')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    storage_path: string;
    caption: string | null;
    gps_lat: number | null;
    gps_lng: number | null;
  }[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    url: urlByPath.get(r.storage_path) ?? null,
    caption: r.caption,
    gpsLat: r.gps_lat,
    gpsLng: r.gps_lng,
  }));
}

/** Upload a captured photo (base64 from the image picker) and record it as task
 *  evidence. Storage RLS + task_media RLS both authorize the write. Location is
 *  best-effort — read from the photo's EXIF where present. */
export async function uploadTaskPhoto(params: {
  orgId: string;
  projectId: string;
  taskId: string;
  base64: string;
  ext: string;
  mime: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  subtaskId?: string | null;
  purpose?: string;
}): Promise<void> {
  const { orgId, projectId, taskId, base64, ext, mime, gpsLat, gpsLng, subtaskId, purpose } = params;
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `${orgId}/${projectId}/tasks/${taskId}/${name}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType: mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const user = await currentUser();
  const { error } = await supabase.from('task_media').insert({
    org_id: orgId,
    project_id: projectId,
    task_id: taskId,
    subtask_id: subtaskId ?? null,
    kind: 'photo',
    purpose: purpose ?? 'completion',
    storage_path: path,
    gps_lat: gpsLat ?? null,
    gps_lng: gpsLng ?? null,
    captured_at: new Date().toISOString(),
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Per-step evidence for a task, keyed by subtask id (signed URLs). */
export async function listSubtaskPhotos(taskId: string): Promise<Record<string, TaskPhoto[]>> {
  const { data } = await supabase
    .from('task_media')
    .select('id, subtask_id, storage_path, caption, gps_lat, gps_lng')
    .eq('task_id', taskId)
    .not('subtask_id', 'is', null)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    subtask_id: string;
    storage_path: string;
    caption: string | null;
    gps_lat: number | null;
    gps_lng: number | null;
  }[];
  if (rows.length === 0) return {};
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  const out: Record<string, TaskPhoto[]> = {};
  for (const r of rows) {
    (out[r.subtask_id] ??= []).push({
      id: r.id,
      url: urlByPath.get(r.storage_path) ?? null,
      caption: r.caption,
      gpsLat: r.gps_lat,
      gpsLng: r.gps_lng,
    });
  }
  return out;
}
