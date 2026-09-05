import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';
import { assertUploadSize, MAX_PROJECT_MEDIA_BYTES } from '../upload-limits';

const BUCKET = 'project-media';

export type RfiPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RfiStatus = 'open' | 'answered' | 'closed' | 'reopened';
export type Discipline =
  | 'architectural'
  | 'structural'
  | 'civil'
  | 'mechanical'
  | 'electrical'
  | 'plumbing'
  | 'landscape'
  | 'survey'
  | 'other';

export const PRIORITIES: RfiPriority[] = ['low', 'medium', 'high', 'urgent'];
export const DISCIPLINES: Discipline[] = [
  'architectural',
  'structural',
  'civil',
  'mechanical',
  'electrical',
  'plumbing',
  'landscape',
  'survey',
  'other',
];
export const PRIORITY_LABEL: Record<RfiPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const STATUS_LABEL: Record<RfiStatus, string> = { open: 'Open', answered: 'Answered', closed: 'Closed', reopened: 'Reopened' };
export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  architectural: 'Architectural',
  structural: 'Structural',
  civil: 'Civil',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  landscape: 'Landscape',
  survey: 'Survey',
  other: 'Other',
};

export interface RfiAttachment {
  id: string;
  url: string | null;
  filename: string | null;
}

export interface Rfi {
  id: string;
  number: number;
  projectId: string;
  subject: string;
  detail: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  status: RfiStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  answer: string | null;
  answeredByName: string | null;
  raisedById: string | null;
  raisedByName: string | null;
  createdAt: string;
  attachments: RfiAttachment[];
}

type RfiRow = {
  id: string;
  number: number;
  project_id: string;
  subject: string;
  detail: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  status: RfiStatus;
  assignee_id: string | null;
  due_date: string | null;
  answer: string | null;
  answered_by: string | null;
  raised_by: string | null;
  created_at: string;
};

const SELECT =
  'id, number, project_id, subject, detail, discipline, priority, status, assignee_id, due_date, answer, answered_by, raised_by, created_at';

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

/** Every RFI on a project (newest first), each with its attachments signed for viewing. */
export async function listProjectRfis(projectId: string): Promise<Rfi[]> {
  const { data } = await supabase
    .from('rfis')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as RfiRow[];
  if (rows.length === 0) return [];

  const { data: attData } = await supabase
    .from('rfi_attachments')
    .select('id, rfi_id, storage_path, filename')
    .in(
      'rfi_id',
      rows.map((r) => r.id),
    )
    .order('created_at', { ascending: true });
  const atts = (attData ?? []) as { id: string; rfi_id: string; storage_path: string; filename: string | null }[];

  const signed = new Map<string, string>();
  if (atts.length) {
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(
      atts.map((a) => a.storage_path),
      60 * 60,
    );
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }
  const byRfi = new Map<string, RfiAttachment[]>();
  for (const a of atts) {
    const arr = byRfi.get(a.rfi_id) ?? [];
    arr.push({ id: a.id, url: signed.get(a.storage_path) ?? null, filename: a.filename });
    byRfi.set(a.rfi_id, arr);
  }

  const names = await resolveNames([...rows.map((r) => r.assignee_id), ...rows.map((r) => r.raised_by), ...rows.map((r) => r.answered_by)]);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    subject: r.subject,
    detail: r.detail,
    discipline: r.discipline,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? names.get(r.assignee_id) ?? null : null,
    dueDate: r.due_date,
    answer: r.answer,
    answeredByName: r.answered_by ? names.get(r.answered_by) ?? null : null,
    raisedById: r.raised_by,
    raisedByName: r.raised_by ? names.get(r.raised_by) ?? null : null,
    createdAt: r.created_at,
    attachments: byRfi.get(r.id) ?? [],
  }));
}

async function projectOrg(projectId: string): Promise<{ orgId: string } | null> {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const p = data as { org_id: string } | null;
  return p ? { orgId: p.org_id } : null;
}

/** owner/admin/pm — the manager gate (also enforced by the DB). */
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
      p_link: `/projects/${projectId}/rfis`,
      p_entity_type: 'task',
      p_entity_id: entityId,
    });
  } catch {
    /* best-effort */
  }
}

export async function raiseRfi(args: {
  projectId: string;
  subject: string;
  detail?: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const proj = await projectOrg(args.projectId);
  if (!proj) throw new Error('Project not found.');

  const { data, error } = await supabase
    .from('rfis')
    .insert({
      org_id: proj.orgId,
      project_id: args.projectId,
      subject: args.subject.trim(),
      detail: args.detail?.trim() || null,
      discipline: args.discipline,
      priority: args.priority,
      assignee_id: args.assigneeId ?? null,
      due_date: args.dueDate ?? null,
      raised_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) throw new Error(error.message);
  const rfi = data as { id: string; number: number };
  if (args.assigneeId && args.assigneeId !== user.id) {
    await notifyOne(proj.orgId, args.assigneeId, args.projectId, 'rfi_raised', `RFI #${rfi.number}`, args.subject.trim(), rfi.id);
  }
  return rfi.id;
}

export async function updateRfi(args: {
  id: string;
  projectId: string;
  subject: string;
  detail?: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: before } = await supabase.from('rfis').select('org_id, assignee_id, number').eq('id', args.id).maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null; number: number } | null;

  const { error } = await supabase
    .from('rfis')
    .update({
      subject: args.subject.trim(),
      detail: args.detail?.trim() || null,
      discipline: args.discipline,
      priority: args.priority,
      assignee_id: args.assigneeId ?? null,
      due_date: args.dueDate ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) throw new Error(error.message);
  if (b && args.assigneeId && args.assigneeId !== b.assignee_id && args.assigneeId !== user.id) {
    await notifyOne(b.org_id, args.assigneeId, args.projectId, 'rfi_raised', `RFI #${b.number} assigned`, args.subject.trim(), args.id);
  }
}

export async function answerRfi(id: string, projectId: string, answer: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  if (answer.trim().length < 2) throw new Error('Write an answer.');
  const { data: rfi } = await supabase.from('rfis').select('org_id, number, subject, raised_by').eq('id', id).maybeSingle();
  const r = rfi as { org_id: string; number: number; subject: string; raised_by: string | null } | null;
  if (!r) throw new Error('RFI not found.');

  const { error } = await supabase
    .from('rfis')
    .update({ answer: answer.trim(), answered_at: new Date().toISOString(), answered_by: user.id, status: 'answered', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  if (r.raised_by && r.raised_by !== user.id) {
    await notifyOne(r.org_id, r.raised_by, projectId, 'rfi_answered', `RFI #${r.number} answered`, r.subject, id);
  }
}

export async function closeRfi(id: string): Promise<void> {
  const { error } = await supabase.from('rfis').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function reopenRfi(id: string, projectId: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: rfi } = await supabase.from('rfis').select('org_id, number, subject, assignee_id').eq('id', id).maybeSingle();
  const r = rfi as { org_id: string; number: number; subject: string; assignee_id: string | null } | null;

  const { error } = await supabase.from('rfis').update({ status: 'reopened', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  if (r?.assignee_id && r.assignee_id !== user.id) {
    await notifyOne(r.org_id, r.assignee_id, projectId, 'rfi_raised', `RFI #${r.number} reopened`, `${r.subject} — the answer wasn't accepted`, id);
  }
}

export async function deleteRfi(id: string): Promise<void> {
  const { error } = await supabase.from('rfis').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Upload a captured photo to project-media and record it against the RFI. */
export async function addRfiAttachment(params: {
  rfiId: string;
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

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${params.ext}`;
  const path = `${proj.orgId}/${params.projectId}/rfis/${params.rfiId}/${filename}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from('rfi_attachments').insert({
    rfi_id: params.rfiId,
    org_id: proj.orgId,
    project_id: params.projectId,
    storage_path: path,
    filename,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message);
}
