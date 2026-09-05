import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';
import { assertUploadSize, MAX_PROJECT_MEDIA_BYTES } from '../upload-limits';

const BUCKET = 'project-media';

export type SnagSeverity = 'minor' | 'major' | 'critical';
export type SnagStatus = 'open' | 'fixed' | 'verified' | 'reopened' | 'charged';

export const SEVERITY_LABEL: Record<SnagSeverity, string> = { minor: 'Minor', major: 'Major', critical: 'Critical' };
export const STATUS_LABEL: Record<SnagStatus, string> = {
  open: 'Open',
  fixed: 'Fixed — awaiting check',
  verified: 'Verified',
  reopened: 'Reopened',
  charged: 'Charged to retention',
};
export const SEVERITIES: SnagSeverity[] = ['minor', 'major', 'critical'];

export interface SnagPhoto {
  id: string;
  url: string | null;
  caption: string | null;
}

export interface Snag {
  id: string;
  number: number;
  projectId: string;
  title: string;
  description: string | null;
  location: string | null;
  severity: SnagSeverity;
  status: SnagStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  raisedById: string | null;
  raisedByName: string | null;
  createdAt: string;
  photos: SnagPhoto[];
}

type SnagRow = {
  id: string;
  number: number;
  project_id: string;
  title: string;
  description: string | null;
  location: string | null;
  severity: SnagSeverity;
  status: SnagStatus;
  assignee_id: string | null;
  due_date: string | null;
  raised_by: string | null;
  created_at: string;
};

const SELECT =
  'id, number, project_id, title, description, location, severity, status, assignee_id, due_date, raised_by, created_at';

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

/** Every snag on a project (newest first), each with its photos signed for an hour. */
export async function listProjectSnags(projectId: string): Promise<Snag[]> {
  const { data } = await supabase
    .from('snags')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as SnagRow[];
  if (rows.length === 0) return [];

  const { data: photoRows } = await supabase
    .from('snag_photos')
    .select('id, snag_id, storage_path, caption')
    .in(
      'snag_id',
      rows.map((r) => r.id),
    )
    .order('created_at', { ascending: true });
  const photos = (photoRows ?? []) as { id: string; snag_id: string; storage_path: string; caption: string | null }[];

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
  const byId = new Map<string, SnagPhoto[]>();
  for (const p of photos) {
    const arr = byId.get(p.snag_id) ?? [];
    arr.push({ id: p.id, url: signed.get(p.storage_path) ?? null, caption: p.caption });
    byId.set(p.snag_id, arr);
  }

  const names = await resolveNames([...rows.map((r) => r.assignee_id), ...rows.map((r) => r.raised_by)]);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    location: r.location,
    severity: r.severity,
    status: r.status,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? names.get(r.assignee_id) ?? null : null,
    dueDate: r.due_date,
    raisedById: r.raised_by,
    raisedByName: r.raised_by ? names.get(r.raised_by) ?? null : null,
    createdAt: r.created_at,
    photos: byId.get(r.id) ?? [],
  }));
}

async function projectOrg(projectId: string): Promise<{ orgId: string; name: string } | null> {
  const { data } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const p = data as { org_id: string; name: string } | null;
  return p ? { orgId: p.org_id, name: p.name } : null;
}

/** owner/admin/pm — the manager gate for verify/reopen (also enforced by the DB). */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const proj = await projectOrg(projectId);
  if (!proj) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', proj.orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

async function notifyOne(orgId: string, userId: string, projectId: string, type: string, title: string, body: string, entityId: string) {
  try {
    await supabase.rpc('notify', {
      p_org: orgId,
      p_user: userId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_link: `/projects/${projectId}/snags`,
      p_entity_type: 'task',
      p_entity_id: entityId,
    });
  } catch {
    /* best-effort */
  }
}

async function notifyManagers(orgId: string, projectId: string, meId: string, type: string, title: string, body: string, entityId: string) {
  const { data } = await supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('role', 'pm');
  for (const pm of (data ?? []) as { user_id: string }[]) {
    if (pm.user_id !== meId) await notifyOne(orgId, pm.user_id, projectId, type, title, body, entityId);
  }
}

export async function raiseSnag(args: {
  projectId: string;
  title: string;
  severity: SnagSeverity;
  description?: string | null;
  location?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const proj = await projectOrg(args.projectId);
  if (!proj) throw new Error('Project not found.');

  const { data, error } = await supabase
    .from('snags')
    .insert({
      org_id: proj.orgId,
      project_id: args.projectId,
      title: args.title.trim(),
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      severity: args.severity,
      assignee_id: args.assigneeId ?? null,
      due_date: args.dueDate ?? null,
      raised_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) throw new Error(error.message);
  const snag = data as { id: string; number: number };

  if (args.assigneeId && args.assigneeId !== user.id) {
    await notifyOne(
      proj.orgId,
      args.assigneeId,
      args.projectId,
      'snag_raised',
      `Snag #${snag.number} — ${proj.name}`,
      `${args.title.trim()}${args.location ? ` · ${args.location}` : ''}`,
      snag.id,
    );
  }
  return snag.id;
}

export async function updateSnag(args: {
  id: string;
  projectId: string;
  title: string;
  severity: SnagSeverity;
  description?: string | null;
  location?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: before } = await supabase.from('snags').select('org_id, assignee_id, number').eq('id', args.id).maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null; number: number } | null;

  const { error } = await supabase
    .from('snags')
    .update({
      title: args.title.trim(),
      severity: args.severity,
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      assignee_id: args.assigneeId ?? null,
      due_date: args.dueDate ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) throw new Error(error.message);

  if (b && args.assigneeId && args.assigneeId !== b.assignee_id && args.assigneeId !== user.id) {
    const proj = await projectOrg(args.projectId);
    await notifyOne(
      b.org_id,
      args.assigneeId,
      args.projectId,
      'snag_raised',
      `Snag #${b.number} assigned — ${proj?.name ?? 'a project'}`,
      args.title.trim(),
      args.id,
    );
  }
}

export async function markSnagFixed(id: string, projectId: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: snag } = await supabase.from('snags').select('org_id, number, title, status').eq('id', id).maybeSingle();
  const s = snag as { org_id: string; number: number; title: string; status: string } | null;
  if (!s) throw new Error('Snag not found.');
  if (!['open', 'reopened'].includes(s.status)) throw new Error('Only an open snag can be marked fixed.');

  const { error } = await supabase
    .from('snags')
    .update({ status: 'fixed', fixed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  const proj = await projectOrg(projectId);
  await notifyManagers(s.org_id, projectId, user.id, 'snag_fixed', `Snag #${s.number} fixed — ${proj?.name ?? 'a project'}`, `${s.title} — ready to check`, id);
}

export async function verifySnag(id: string): Promise<void> {
  const { error } = await supabase
    .from('snags')
    .update({ status: 'verified', verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function reopenSnag(id: string, projectId: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: snag } = await supabase.from('snags').select('org_id, number, title, assignee_id').eq('id', id).maybeSingle();
  const s = snag as { org_id: string; number: number; title: string; assignee_id: string | null } | null;
  if (!s) throw new Error('Snag not found.');

  const { error } = await supabase
    .from('snags')
    .update({ status: 'reopened', fixed_at: null, verified_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  if (s.assignee_id && s.assignee_id !== user.id) {
    const proj = await projectOrg(projectId);
    await notifyOne(s.org_id, s.assignee_id, projectId, 'snag_raised', `Snag #${s.number} reopened — ${proj?.name ?? 'a project'}`, `${s.title} — the fix wasn't accepted`, id);
  }
}

export async function deleteSnag(id: string): Promise<void> {
  const { error } = await supabase.from('snags').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Upload a captured photo to project-media and record it against the snag. */
export async function addSnagPhoto(params: {
  snagId: string;
  projectId: string;
  base64: string;
  ext: string;
  mime: string;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const proj = await projectOrg(params.projectId);
  if (!proj) throw new Error('Project not found.');
  assertUploadSize(params.base64, MAX_PROJECT_MEDIA_BYTES, 'This photo');

  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${params.ext}`;
  const path = `${proj.orgId}/${params.projectId}/snags/${params.snagId}/${name}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from('snag_photos').insert({
    snag_id: params.snagId,
    org_id: proj.orgId,
    project_id: params.projectId,
    storage_path: path,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSnagPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.from('snag_photos').delete().eq('id', photoId);
  if (error) throw new Error(error.message);
}
