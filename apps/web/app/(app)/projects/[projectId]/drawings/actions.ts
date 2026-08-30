'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

const DISCIPLINES = [
  'architectural',
  'structural',
  'civil',
  'mechanical',
  'electrical',
  'plumbing',
  'landscape',
  'survey',
  'other',
] as const;
const STATUSES = ['for_review', 'for_construction', 'for_information', 'superseded', 'as_built'] as const;

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

function text(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/** When a sheet is issued for construction, tell the project team. Best-effort. */
async function notifyForConstruction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { orgId: string; projectId: string; actorId: string; number: string; title: string; revision: string },
) {
  const { data: proj } = await supabase.from('projects').select('name').eq('id', args.projectId).maybeSingle();
  const projectName = (proj as { name: string } | null)?.name ?? 'a project';
  const by = await actorName(supabase, args.actorId);
  const { data: members } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', args.projectId)
    .eq('status', 'active');
  const recipients = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== args.actorId);
  await Promise.all(
    recipients.map((userId) =>
      notifyUser(supabase, {
        orgId: args.orgId,
        userId,
        type: 'drawing_issued',
        title: `${by} issued ${args.number} Rev ${args.revision} for construction — ${projectName}`,
        body: args.title,
        link: `/projects/${args.projectId}/drawings`,
      }),
    ),
  );
}

/** Add a new drawing to the register with its first revision (and PDF). */
export async function createDrawing(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const number = String(formData.get('number') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const discipline = String(formData.get('discipline') ?? 'architectural');
  const revision = String(formData.get('revision') ?? '').trim() || 'A';
  const status = String(formData.get('status') ?? 'for_review');
  const issueDate = text(formData.get('issueDate'));
  const storagePath = text(formData.get('storagePath'));
  const filename = text(formData.get('filename'));
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (number.length < 1) return { ok: false, error: 'Give the drawing a number.' };
  if (title.length < 2) return { ok: false, error: 'Give the drawing a title.' };
  if (!DISCIPLINES.includes(discipline as (typeof DISCIPLINES)[number])) return { ok: false, error: 'Invalid discipline.' };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { ok: false, error: 'Invalid status.' };

  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('drawings')
    .insert({ org_id: project.org_id, project_id: projectId, number, title, discipline, created_by: user.id })
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message.includes('duplicate') ? `Drawing ${number} already exists.` : error.message };
  }
  const drawingId = (inserted as { id: string }).id;

  const { error: revErr } = await supabase.from('drawing_revisions').insert({
    drawing_id: drawingId,
    org_id: project.org_id,
    project_id: projectId,
    revision,
    status,
    issue_date: issueDate,
    storage_path: storagePath,
    filename,
    uploaded_by: user.id,
  });
  if (revErr) return { ok: false, error: revErr.message };

  if (status === 'for_construction') {
    await notifyForConstruction(supabase, { orgId: project.org_id, projectId, actorId: user.id, number, title, revision });
  }
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}

/** Issue a new revision of an existing drawing — supersedes the prior revisions. */
export async function addRevision(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const drawingId = String(formData.get('drawingId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const revision = String(formData.get('revision') ?? '').trim();
  const status = String(formData.get('status') ?? 'for_review');
  const issueDate = text(formData.get('issueDate'));
  const storagePath = text(formData.get('storagePath'));
  const filename = text(formData.get('filename'));
  if (!drawingId || !projectId) return { ok: false, error: 'Missing drawing.' };
  if (!revision) return { ok: false, error: 'Give the revision a label (e.g. B).' };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { ok: false, error: 'Invalid status.' };

  const { data: draw } = await supabase.from('drawings').select('org_id, number, title').eq('id', drawingId).maybeSingle();
  const d = draw as { org_id: string; number: string; title: string } | null;
  if (!d) return { ok: false, error: 'Drawing not found.' };

  // Supersede every prior revision — the new one becomes current.
  await supabase.from('drawing_revisions').update({ status: 'superseded' }).eq('drawing_id', drawingId);

  const { error } = await supabase.from('drawing_revisions').insert({
    drawing_id: drawingId,
    org_id: d.org_id,
    project_id: projectId,
    revision,
    status,
    issue_date: issueDate,
    storage_path: storagePath,
    filename,
    uploaded_by: user.id,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes('duplicate') ? `Revision ${revision} already exists for this drawing.` : error.message,
    };
  }
  await supabase.from('drawings').update({ updated_at: new Date().toISOString() }).eq('id', drawingId);

  if (status === 'for_construction') {
    await notifyForConstruction(supabase, { orgId: d.org_id, projectId, actorId: user.id, number: d.number, title: d.title, revision });
  }
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}

/** Change a single revision's status (e.g. mark it for construction, or as-built). */
export async function updateRevisionStatus(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const revisionId = String(formData.get('revisionId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!revisionId || !projectId) return { ok: false, error: 'Missing revision.' };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { ok: false, error: 'Invalid status.' };
  const { error } = await supabase.from('drawing_revisions').update({ status }).eq('id', revisionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}

export async function updateDrawing(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const number = String(formData.get('number') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const discipline = String(formData.get('discipline') ?? 'architectural');
  if (!id || !projectId) return { ok: false, error: 'Missing drawing.' };
  if (number.length < 1 || title.length < 2) return { ok: false, error: 'Number and title are required.' };
  const { error } = await supabase
    .from('drawings')
    .update({ number, title, discipline, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    return { ok: false, error: error.message.includes('duplicate') ? `Drawing ${number} already exists.` : error.message };
  }
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}

export async function deleteRevision(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const revisionId = String(formData.get('revisionId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!revisionId || !projectId) return { ok: false, error: 'Missing revision.' };
  const { error } = await supabase.from('drawing_revisions').delete().eq('id', revisionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}

export async function deleteDrawing(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing drawing.' };
  const { error } = await supabase.from('drawings').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/drawings`);
  return { ok: true };
}
