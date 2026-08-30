'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notifyUser, notifyProjectManagers } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

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

/** A friendly manager check mirroring the DB trigger's
 *  `is_org_staff(org_id) OR project_role = 'pm'` gate. The trigger is the real
 *  enforcement — this just turns a raw DB exception into a clean error. */
async function isProjectManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  const [orgRes, projRes] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
  ]);
  const orgRole = (orgRes.data as { role: string } | null)?.role;
  const projectRole = (projRes.data as { role: string } | null)?.role;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

const SEVERITIES = ['minor', 'major', 'critical'] as const;

/** Raise a defect against the project and (optionally) assign a contractor, who
 *  is notified. The per-project ref number is set by the DB trigger. */
export async function raiseSnag(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const severity = String(formData.get('severity') ?? 'major');
  const description = text(formData.get('description'));
  const location = text(formData.get('location'));
  const assigneeId = text(formData.get('assigneeId'));
  const dueDate = text(formData.get('dueDate'));
  const taskId = text(formData.get('taskId'));
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (title.length < 2) return { ok: false, error: 'Give the defect a short title.' };
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) return { ok: false, error: 'Invalid severity.' };

  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string; name: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('snags')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      task_id: taskId,
      title,
      description,
      location,
      severity,
      assignee_id: assigneeId,
      due_date: dueDate,
      raised_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) return { ok: false, error: error.message };
  const snag = inserted as { id: string; number: number };

  if (assigneeId && assigneeId !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: project.org_id,
      userId: assigneeId,
      type: 'snag_raised',
      title: `${by} raised snag #${snag.number} — ${project.name}`,
      body: `${title}${location ? ` · ${location}` : ''}`,
      link: `/projects/${projectId}/snags`,
      entityId: snag.id,
    });
  }

  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

/** Edit a snag's core details or reassign it. The raiser or a manager may. */
export async function updateSnag(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const severity = String(formData.get('severity') ?? 'major');
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };
  if (title.length < 2) return { ok: false, error: 'Give the defect a short title.' };

  const nextAssignee = text(formData.get('assigneeId'));
  const { data: before } = await supabase.from('snags').select('org_id, assignee_id, number').eq('id', id).maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null; number: number } | null;

  const { error } = await supabase
    .from('snags')
    .update({
      title,
      severity,
      description: text(formData.get('description')),
      location: text(formData.get('location')),
      assignee_id: nextAssignee,
      due_date: text(formData.get('dueDate')),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  // Notify a newly-assigned contractor.
  if (b && nextAssignee && nextAssignee !== b.assignee_id && nextAssignee !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: b.org_id,
      userId: nextAssignee,
      type: 'snag_raised',
      title: `${by} assigned you snag #${b.number} — ${(proj as { name: string } | null)?.name ?? 'a project'}`,
      body: title,
      link: `/projects/${projectId}/snags`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

/** The assigned contractor marks a defect fixed; the project's PMs are notified. */
export async function markSnagFixed(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };

  const { data: snag } = await supabase.from('snags').select('org_id, number, title, status').eq('id', id).maybeSingle();
  const s = snag as { org_id: string; number: number; title: string; status: string } | null;
  if (!s) return { ok: false, error: 'Snag not found.' };
  if (!['open', 'reopened'].includes(s.status)) return { ok: false, error: 'Only an open snag can be marked fixed.' };

  const { error } = await supabase
    .from('snags')
    .update({ status: 'fixed', fixed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
  const by = await actorName(supabase, user.id);
  await notifyProjectManagers(supabase, {
    orgId: s.org_id,
    projectId,
    type: 'snag_fixed',
    title: `${by} marked snag #${s.number} fixed — ${(proj as { name: string } | null)?.name ?? 'a project'}`,
    body: `${s.title} — ready to check`,
    link: `/projects/${projectId}/snags`,
    entityId: id,
  });

  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

/** A manager confirms the fix. Terminal, good outcome. */
export async function verifySnag(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };

  const { data: snag } = await supabase.from('snags').select('org_id').eq('id', id).maybeSingle();
  const s = snag as { org_id: string } | null;
  if (!s) return { ok: false, error: 'Snag not found.' };
  if (!(await isProjectManager(supabase, user.id, s.org_id, projectId)))
    return { ok: false, error: 'Only a project manager can verify or reopen a defect.' };

  const { error } = await supabase
    .from('snags')
    .update({ status: 'verified', verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

/** A manager rejects the fix — back to the contractor. */
export async function reopenSnag(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };

  const { data: snag } = await supabase.from('snags').select('org_id, number, title, assignee_id').eq('id', id).maybeSingle();
  const s = snag as { org_id: string; number: number; title: string; assignee_id: string | null } | null;
  if (!s) return { ok: false, error: 'Snag not found.' };
  if (!(await isProjectManager(supabase, user.id, s.org_id, projectId)))
    return { ok: false, error: 'Only a project manager can verify or reopen a defect.' };

  const { error } = await supabase
    .from('snags')
    .update({ status: 'reopened', fixed_at: null, verified_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (s?.assignee_id && s.assignee_id !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    await notifyUser(supabase, {
      orgId: s.org_id,
      userId: s.assignee_id,
      type: 'snag_raised',
      title: `Snag #${s.number} reopened — ${(proj as { name: string } | null)?.name ?? 'a project'}`,
      body: `${s.title} — the fix wasn't accepted`,
      link: `/projects/${projectId}/snags`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

/** Charge the repair against the assigned contractor's retention. Reuses the
 *  immutable retention ledger via the existing record_retention_deduction RPC
 *  (which gates PM/staff/finance itself), then links the deduction to the snag
 *  and marks it charged. */
export async function deductSnagFromRetention(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const amountCents = Number(formData.get('amountCents'));
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { ok: false, error: 'Enter a valid amount.' };

  const { data: snag } = await supabase
    .from('snags')
    .select('org_id, number, title, assignee_id, status')
    .eq('id', id)
    .maybeSingle();
  const s = snag as { org_id: string; number: number; title: string; assignee_id: string | null; status: string } | null;
  if (!s) return { ok: false, error: 'Snag not found.' };
  if (!s.assignee_id) return { ok: false, error: 'Assign the snag to a contractor before charging retention.' };
  if (s.status === 'charged') return { ok: false, error: 'This snag has already been charged.' };

  const { data: dedId, error: rpcErr } = await supabase.rpc('record_retention_deduction', {
    p_project: projectId,
    p_contractor: s.assignee_id,
    p_amount: amountCents,
    p_reason: `Snag #${s.number}: ${s.title}`,
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };

  const { error } = await supabase
    .from('snags')
    .update({ retention_deduction_id: dedId as string, status: 'charged', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (s.assignee_id !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    await notifyUser(supabase, {
      orgId: s.org_id,
      userId: s.assignee_id,
      type: 'retention_deducted',
      title: `Retention charged for snag #${s.number} — ${(proj as { name: string } | null)?.name ?? 'a project'}`,
      body: s.title,
      link: `/projects/${projectId}/snags`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/snags`);
  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

/** Record a photo already uploaded to project-media against a snag. */
export async function recordSnagPhoto(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const snagId = String(formData.get('snagId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const storagePath = String(formData.get('storagePath') ?? '');
  const caption = text(formData.get('caption'));
  if (!snagId || !projectId || !storagePath) return { ok: false, error: 'Missing photo.' };

  const { data: snag } = await supabase.from('snags').select('org_id').eq('id', snagId).maybeSingle();
  const s = snag as { org_id: string } | null;
  if (!s) return { ok: false, error: 'Snag not found.' };

  const { error } = await supabase.from('snag_photos').insert({
    snag_id: snagId,
    org_id: s.org_id,
    project_id: projectId,
    storage_path: storagePath,
    caption,
    uploaded_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

export async function deleteSnagPhoto(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const photoId = String(formData.get('photoId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!photoId || !projectId) return { ok: false, error: 'Missing photo.' };
  const { error } = await supabase.from('snag_photos').delete().eq('id', photoId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}

export async function deleteSnag(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing snag.' };
  const { error } = await supabase.from('snags').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/snags`);
  return { ok: true };
}
