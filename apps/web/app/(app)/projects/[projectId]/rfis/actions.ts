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
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

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

async function projectName(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string): Promise<string> {
  const { data } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
  return (data as { name: string } | null)?.name ?? 'a project';
}

function text(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/** Raise an RFI and (optionally) assign a responder, who is notified. The
 *  per-project number is set by the DB trigger. */
export async function raiseRfi(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const subject = String(formData.get('subject') ?? '').trim();
  const discipline = String(formData.get('discipline') ?? 'architectural');
  const priority = String(formData.get('priority') ?? 'medium');
  const detail = text(formData.get('detail'));
  const assigneeId = text(formData.get('assigneeId'));
  const dueDate = text(formData.get('dueDate'));
  const drawingId = text(formData.get('drawingId'));
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (subject.length < 2) return { ok: false, error: 'Give the RFI a subject.' };
  if (!DISCIPLINES.includes(discipline as (typeof DISCIPLINES)[number])) return { ok: false, error: 'Invalid discipline.' };
  if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) return { ok: false, error: 'Invalid priority.' };

  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('rfis')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      subject,
      detail,
      discipline,
      priority,
      drawing_id: drawingId,
      assignee_id: assigneeId,
      due_date: dueDate,
      raised_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) return { ok: false, error: error.message };
  const rfi = inserted as { id: string; number: number };

  if (assigneeId && assigneeId !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: project.org_id,
      userId: assigneeId,
      type: 'rfi_raised',
      title: `${by} raised RFI #${rfi.number} — ${await projectName(supabase, projectId)}`,
      body: subject,
      link: `/projects/${projectId}/rfis`,
      entityId: rfi.id,
    });
  }

  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

/** Edit an RFI's core details or reassign the responder. */
export async function updateRfi(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const subject = String(formData.get('subject') ?? '').trim();
  const discipline = String(formData.get('discipline') ?? 'architectural');
  const priority = String(formData.get('priority') ?? 'medium');
  if (!id || !projectId) return { ok: false, error: 'Missing RFI.' };
  if (subject.length < 2) return { ok: false, error: 'Give the RFI a subject.' };

  const nextAssignee = text(formData.get('assigneeId'));
  const { data: before } = await supabase.from('rfis').select('org_id, assignee_id, number').eq('id', id).maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null; number: number } | null;

  const { error } = await supabase
    .from('rfis')
    .update({
      subject,
      discipline,
      priority,
      detail: text(formData.get('detail')),
      drawing_id: text(formData.get('drawingId')),
      assignee_id: nextAssignee,
      due_date: text(formData.get('dueDate')),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (b && nextAssignee && nextAssignee !== b.assignee_id && nextAssignee !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: b.org_id,
      userId: nextAssignee,
      type: 'rfi_raised',
      title: `${by} assigned you RFI #${b.number} — ${await projectName(supabase, projectId)}`,
      body: subject,
      link: `/projects/${projectId}/rfis`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

/** The responder (or a manager) records the answer — status → answered; the
 *  raiser is notified. */
export async function answerRfi(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const answer = String(formData.get('answer') ?? '').trim();
  if (!id || !projectId) return { ok: false, error: 'Missing RFI.' };
  if (answer.length < 2) return { ok: false, error: 'Write an answer.' };

  const { data: rfi } = await supabase.from('rfis').select('org_id, number, subject, raised_by').eq('id', id).maybeSingle();
  const r = rfi as { org_id: string; number: number; subject: string; raised_by: string | null } | null;
  if (!r) return { ok: false, error: 'RFI not found.' };

  const { error } = await supabase
    .from('rfis')
    .update({ answer, answered_at: new Date().toISOString(), answered_by: user.id, status: 'answered', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (r.raised_by && r.raised_by !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: r.org_id,
      userId: r.raised_by,
      type: 'rfi_answered',
      title: `${by} answered RFI #${r.number} — ${await projectName(supabase, projectId)}`,
      body: r.subject,
      link: `/projects/${projectId}/rfis`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

/** Close an answered RFI (the raiser or a manager accepts the answer). */
export async function closeRfi(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing RFI.' };
  const { error } = await supabase
    .from('rfis')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

/** Reopen an RFI whose answer didn't settle it — back to the responder. */
export async function reopenRfi(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing RFI.' };

  const { data: rfi } = await supabase.from('rfis').select('org_id, number, subject, assignee_id').eq('id', id).maybeSingle();
  const r = rfi as { org_id: string; number: number; subject: string; assignee_id: string | null } | null;

  const { error } = await supabase
    .from('rfis')
    .update({ status: 'reopened', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (r?.assignee_id && r.assignee_id !== user.id) {
    await notifyUser(supabase, {
      orgId: r.org_id,
      userId: r.assignee_id,
      type: 'rfi_raised',
      title: `RFI #${r.number} reopened — ${await projectName(supabase, projectId)}`,
      body: `${r.subject} — the answer wasn't accepted`,
      link: `/projects/${projectId}/rfis`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

export async function recordRfiAttachment(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const rfiId = String(formData.get('rfiId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const storagePath = String(formData.get('storagePath') ?? '');
  const filename = text(formData.get('filename'));
  if (!rfiId || !projectId || !storagePath) return { ok: false, error: 'Missing attachment.' };

  const { data: rfi } = await supabase.from('rfis').select('org_id').eq('id', rfiId).maybeSingle();
  const r = rfi as { org_id: string } | null;
  if (!r) return { ok: false, error: 'RFI not found.' };

  const { error } = await supabase.from('rfi_attachments').insert({
    rfi_id: rfiId,
    org_id: r.org_id,
    project_id: projectId,
    storage_path: storagePath,
    filename,
    uploaded_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

export async function deleteRfiAttachment(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const attachmentId = String(formData.get('attachmentId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!attachmentId || !projectId) return { ok: false, error: 'Missing attachment.' };
  const { error } = await supabase.from('rfi_attachments').delete().eq('id', attachmentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}

export async function deleteRfi(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing RFI.' };
  const { error } = await supabase.from('rfis').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/rfis`);
  return { ok: true };
}
