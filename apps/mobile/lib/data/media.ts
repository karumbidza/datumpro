import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase';

const BUCKET = 'project-media';

export interface TaskPhoto {
  id: string;
  url: string | null; // short-lived signed URL
  caption: string | null;
}

/** Completion/site photos already on a task, newest first, with signed URLs.
 *  The bucket is private, so URLs are minted per request (SELECT RLS gates it). */
export async function listTaskPhotos(taskId: string): Promise<TaskPhoto[]> {
  const { data } = await supabase
    .from('task_media')
    .select('id, storage_path, caption')
    .eq('task_id', taskId)
    .eq('kind', 'photo')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; storage_path: string; caption: string | null }[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({ id: r.id, url: urlByPath.get(r.storage_path) ?? null, caption: r.caption }));
}

/** Upload a captured photo (base64 from the image picker) and record it as task
 *  evidence. Storage RLS + task_media RLS both authorize the write. */
export async function uploadTaskPhoto(params: {
  orgId: string;
  projectId: string;
  taskId: string;
  base64: string;
  ext: string;
  mime: string;
}): Promise<void> {
  const { orgId, projectId, taskId, base64, ext, mime } = params;
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `${orgId}/${projectId}/tasks/${taskId}/${name}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType: mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('task_media').insert({
    org_id: orgId,
    project_id: projectId,
    task_id: taskId,
    kind: 'photo',
    purpose: 'completion',
    storage_path: path,
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}
