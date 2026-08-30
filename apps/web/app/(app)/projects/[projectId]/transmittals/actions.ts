'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

const PURPOSES = ['for_construction', 'for_review', 'for_approval', 'for_information', 'for_record'] as const;
const METHODS = ['email', 'hand', 'courier', 'portal', 'other'] as const;

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

type DrawJoin = { number: string | null; title: string | null } | { number: string | null; title: string | null }[] | null;
const drawNumber = (d: DrawJoin): string | null => (Array.isArray(d) ? d[0]?.number : d?.number) ?? null;
const drawTitle = (d: DrawJoin): string | null => (Array.isArray(d) ? d[0]?.title : d?.title) ?? null;

/** Issue a transmittal: a record that a set of drawing revisions went to a
 *  recipient. Each item snapshots the drawing number/revision/title at issue.
 *  Managers only (RLS). Notifies the recipient when they're a project member. */
export async function createTransmittal(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const recipient = String(formData.get('recipient') ?? '').trim();
  const recipientUserId = text(formData.get('recipientUserId'));
  const purpose = String(formData.get('purpose') ?? 'for_construction');
  const method = String(formData.get('method') ?? 'email');
  const issuedDate = text(formData.get('issuedDate')) ?? new Date().toISOString().slice(0, 10);
  const notes = text(formData.get('notes'));
  const revisionIds = String(formData.get('revisionIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (recipient.length < 2) return { ok: false, error: 'Who is it going to?' };
  if (!PURPOSES.includes(purpose as (typeof PURPOSES)[number])) return { ok: false, error: 'Invalid purpose.' };
  if (!METHODS.includes(method as (typeof METHODS)[number])) return { ok: false, error: 'Invalid method.' };
  if (revisionIds.length === 0) return { ok: false, error: 'Add at least one drawing to transmit.' };

  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string; name: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  // Snapshot the selected revisions from the register (authoritative, server-side).
  const { data: revData } = await supabase
    .from('drawing_revisions')
    .select('id, revision, drawings(number, title)')
    .eq('project_id', projectId)
    .in('id', revisionIds);
  const revs = (revData ?? []) as { id: string; revision: string; drawings: DrawJoin }[];
  if (revs.length === 0) return { ok: false, error: 'The selected drawings could not be found.' };

  const { data: inserted, error } = await supabase
    .from('transmittals')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      recipient,
      recipient_user_id: recipientUserId,
      purpose,
      method,
      issued_date: issuedDate,
      notes,
      issued_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) return { ok: false, error: error.message };
  const tr = inserted as { id: string; number: number };

  const { error: itemErr } = await supabase.from('transmittal_items').insert(
    revs.map((r) => ({
      transmittal_id: tr.id,
      org_id: project.org_id,
      project_id: projectId,
      drawing_revision_id: r.id,
      drawing_number: drawNumber(r.drawings) ?? 'Drawing',
      revision: r.revision,
      title: drawTitle(r.drawings),
    })),
  );
  if (itemErr) return { ok: false, error: itemErr.message };

  if (recipientUserId && recipientUserId !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: project.org_id,
      userId: recipientUserId,
      type: 'transmittal_issued',
      title: `${by} sent you transmittal TR-${String(tr.number).padStart(3, '0')} — ${project.name}`,
      body: `${revs.length} drawing${revs.length === 1 ? '' : 's'}`,
      link: `/projects/${projectId}/transmittals`,
      entityId: tr.id,
    });
  }

  revalidatePath(`/projects/${projectId}/transmittals`);
  return { ok: true };
}

/** Edit a transmittal's header (recipient, purpose, method, date, notes). Managers only. */
export async function updateTransmittal(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const recipient = String(formData.get('recipient') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? 'for_construction');
  const method = String(formData.get('method') ?? 'email');
  if (!id || !projectId) return { ok: false, error: 'Missing transmittal.' };
  if (recipient.length < 2) return { ok: false, error: 'Who is it going to?' };

  const { error } = await supabase
    .from('transmittals')
    .update({
      recipient,
      recipient_user_id: text(formData.get('recipientUserId')),
      purpose,
      method,
      issued_date: text(formData.get('issuedDate')) ?? new Date().toISOString().slice(0, 10),
      notes: text(formData.get('notes')),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/transmittals`);
  return { ok: true };
}

export async function deleteTransmittal(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing transmittal.' };
  const { error } = await supabase.from('transmittals').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/transmittals`);
  return { ok: true };
}
