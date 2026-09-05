import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';
import { assertUploadSize, MAX_PROJECT_MEDIA_BYTES } from '../upload-limits';

const BUCKET = 'project-media';

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
export type RevisionStatus = 'for_review' | 'for_construction' | 'for_information' | 'superseded' | 'as_built';

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
export const REVISION_STATUSES: RevisionStatus[] = ['for_review', 'for_construction', 'for_information', 'as_built'];
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
export const STATUS_LABEL: Record<RevisionStatus, string> = {
  for_review: 'For review',
  for_construction: 'For construction',
  for_information: 'For information',
  superseded: 'Superseded',
  as_built: 'As-built',
};

export interface DrawingRevision {
  id: string;
  revision: string;
  status: RevisionStatus;
  issueDate: string | null;
  url: string | null; // signed PDF url
  filename: string | null;
  createdAt: string;
}

export interface Drawing {
  id: string;
  number: string;
  title: string;
  discipline: Discipline;
  current: DrawingRevision | null;
  revisions: DrawingRevision[];
}

async function resolveOrg(projectId: string): Promise<string | null> {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** owner/admin/pm — the manager gate (also enforced by the DB). */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const orgId = await resolveOrg(projectId);
  if (!orgId) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

/** Every drawing on a project with its current sheet + full revision history,
 *  PDFs signed for an hour. Current = newest non-superseded, else newest. */
export async function listProjectDrawings(projectId: string): Promise<Drawing[]> {
  const { data } = await supabase
    .from('drawings')
    .select('id, number, title, discipline')
    .eq('project_id', projectId)
    .order('number', { ascending: true });
  const rows = (data ?? []) as { id: string; number: string; title: string; discipline: Discipline }[];
  if (rows.length === 0) return [];

  const { data: revData } = await supabase
    .from('drawing_revisions')
    .select('id, drawing_id, revision, status, issue_date, storage_path, filename, created_at')
    .in(
      'drawing_id',
      rows.map((r) => r.id),
    )
    .order('created_at', { ascending: false });
  const revs = (revData ?? []) as {
    id: string;
    drawing_id: string;
    revision: string;
    status: RevisionStatus;
    issue_date: string | null;
    storage_path: string | null;
    filename: string | null;
    created_at: string;
  }[];

  const signed = new Map<string, string>();
  const paths = revs.map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const byDrawing = new Map<string, DrawingRevision[]>();
  for (const r of revs) {
    const arr = byDrawing.get(r.drawing_id) ?? [];
    arr.push({
      id: r.id,
      revision: r.revision,
      status: r.status,
      issueDate: r.issue_date,
      url: r.storage_path ? signed.get(r.storage_path) ?? null : null,
      filename: r.filename,
      createdAt: r.created_at,
    });
    byDrawing.set(r.drawing_id, arr);
  }

  return rows.map((d) => {
    const revisions = byDrawing.get(d.id) ?? [];
    const current = revisions.find((r) => r.status !== 'superseded') ?? revisions[0] ?? null;
    return { id: d.id, number: d.number, title: d.title, discipline: d.discipline, current, revisions };
  });
}

/** Upload a picked PDF (base64) to project-media, returning its storage path. */
async function uploadPdf(projectId: string, base64: string, ext: string): Promise<{ orgId: string; path: string }> {
  const orgId = await resolveOrg(projectId);
  if (!orgId) throw new Error('Project not found.');
  assertUploadSize(base64, MAX_PROJECT_MEDIA_BYTES, 'This PDF');
  const path = `${orgId}/${projectId}/drawings/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), { contentType: 'application/pdf', upsert: false });
  if (error) throw new Error(error.message);
  return { orgId, path };
}

export interface PickedPdf {
  base64: string;
  ext: string;
  filename: string;
}

/** When a sheet is issued for construction, notify every active project member
 *  (except the issuer). Best-effort — never blocks the write. Mirrors web. */
async function notifyForConstruction(
  orgId: string,
  projectId: string,
  actorId: string,
  number: string,
  revision: string,
  title: string,
): Promise<void> {
  try {
    const [{ data: proj }, { data: mems }] = await Promise.all([
      supabase.from('projects').select('name').eq('id', projectId).maybeSingle(),
      supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('status', 'active'),
    ]);
    const pname = (proj as { name: string } | null)?.name ?? 'a project';
    for (const m of (mems ?? []) as { user_id: string }[]) {
      if (m.user_id === actorId) continue;
      await supabase.rpc('notify', {
        p_org: orgId,
        p_user: m.user_id,
        p_type: 'drawing_issued',
        p_title: `${number} Rev ${revision} issued for construction — ${pname}`,
        p_body: title,
        p_link: `/projects/${projectId}/drawings`,
        p_entity_type: 'task',
        p_entity_id: null,
      });
    }
  } catch {
    /* best-effort */
  }
}

export async function createDrawing(args: {
  projectId: string;
  number: string;
  title: string;
  discipline: Discipline;
  revision: string;
  status: RevisionStatus;
  issueDate: string | null;
  pdf: PickedPdf | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const orgId = await resolveOrg(args.projectId);
  if (!orgId) throw new Error('Project not found.');

  const { data, error } = await supabase
    .from('drawings')
    .insert({ org_id: orgId, project_id: args.projectId, number: args.number.trim(), title: args.title.trim(), discipline: args.discipline, created_by: user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message.includes('duplicate') ? `Drawing ${args.number} already exists.` : error.message);
  const drawingId = (data as { id: string }).id;

  let storagePath: string | null = null;
  let filename: string | null = null;
  if (args.pdf) {
    const up = await uploadPdf(args.projectId, args.pdf.base64, args.pdf.ext);
    storagePath = up.path;
    filename = args.pdf.filename;
  }

  const { error: revErr } = await supabase.from('drawing_revisions').insert({
    drawing_id: drawingId,
    org_id: orgId,
    project_id: args.projectId,
    revision: args.revision.trim() || 'A',
    status: args.status,
    issue_date: args.issueDate,
    storage_path: storagePath,
    filename,
    uploaded_by: user.id,
  });
  if (revErr) throw new Error(revErr.message);

  if (args.status === 'for_construction') {
    await notifyForConstruction(orgId, args.projectId, user.id, args.number.trim(), args.revision.trim() || 'A', args.title.trim());
  }
}

/** Issue a new revision — supersedes every prior revision of the drawing. */
export async function addRevision(args: {
  drawingId: string;
  projectId: string;
  revision: string;
  status: RevisionStatus;
  issueDate: string | null;
  pdf: PickedPdf | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  if (!args.revision.trim()) throw new Error('Give the revision a label (e.g. B).');
  const { data: draw } = await supabase.from('drawings').select('org_id, number, title').eq('id', args.drawingId).maybeSingle();
  const d = draw as { org_id: string; number: string; title: string } | null;
  if (!d) throw new Error('Drawing not found.');
  const orgId = d.org_id;

  await supabase.from('drawing_revisions').update({ status: 'superseded' }).eq('drawing_id', args.drawingId);

  let storagePath: string | null = null;
  let filename: string | null = null;
  if (args.pdf) {
    const up = await uploadPdf(args.projectId, args.pdf.base64, args.pdf.ext);
    storagePath = up.path;
    filename = args.pdf.filename;
  }

  const { error } = await supabase.from('drawing_revisions').insert({
    drawing_id: args.drawingId,
    org_id: orgId,
    project_id: args.projectId,
    revision: args.revision.trim(),
    status: args.status,
    issue_date: args.issueDate,
    storage_path: storagePath,
    filename,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message.includes('duplicate') ? `Revision ${args.revision} already exists.` : error.message);
  await supabase.from('drawings').update({ updated_at: new Date().toISOString() }).eq('id', args.drawingId);

  if (args.status === 'for_construction') {
    await notifyForConstruction(orgId, args.projectId, user.id, d.number, args.revision.trim(), d.title);
  }
}

export async function updateRevisionStatus(revisionId: string, status: RevisionStatus): Promise<void> {
  const { error } = await supabase.from('drawing_revisions').update({ status }).eq('id', revisionId);
  if (error) throw new Error(error.message);
}

export async function updateDrawing(args: { id: string; number: string; title: string; discipline: Discipline }): Promise<void> {
  const { error } = await supabase
    .from('drawings')
    .update({ number: args.number.trim(), title: args.title.trim(), discipline: args.discipline, updated_at: new Date().toISOString() })
    .eq('id', args.id);
  if (error) throw new Error(error.message.includes('duplicate') ? `Drawing ${args.number} already exists.` : error.message);
}

export async function deleteRevision(revisionId: string): Promise<void> {
  const { error } = await supabase.from('drawing_revisions').delete().eq('id', revisionId);
  if (error) throw new Error(error.message);
}

export async function deleteDrawing(id: string): Promise<void> {
  const { error } = await supabase.from('drawings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
