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

async function projectName(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string): Promise<string> {
  const { data } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
  return (data as { name: string } | null)?.name ?? 'a project';
}

function text(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/** Raise a variation for approval. Any project member may submit one (RLS forces
 *  status='submitted' for non-managers). The project's PMs are notified. */
export async function createVariation(formData: FormData): Promise<Result> {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const reference = text(formData.get('reference'));
  const costImpactCents = Math.round(Number(formData.get('costImpactCents')));
  const timeImpactDays = Math.round(Number(formData.get('timeImpactDays')));
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (description.length < 2) return { ok: false, error: 'Describe the change.' };
  if (!Number.isFinite(costImpactCents)) return { ok: false, error: 'Enter a valid cost impact.' };
  if (!Number.isFinite(timeImpactDays)) return { ok: false, error: 'Enter a valid time impact.' };

  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('variation_orders')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      reference,
      description,
      cost_impact_cents: costImpactCents,
      time_impact_days: timeImpactDays,
      status: 'submitted',
      created_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) return { ok: false, error: error.message };
  const vo = inserted as { id: string; number: number };

  const by = await actorName(supabase, user.id);
  await notifyProjectManagers(supabase, {
    orgId: project.org_id,
    projectId,
    type: 'variation_submitted',
    title: `${by} raised VO #${vo.number} — ${await projectName(supabase, projectId)}`,
    body: description,
    link: `/projects/${projectId}/variations`,
    entityId: vo.id,
  });

  revalidatePath(`/projects/${projectId}/variations`);
  return { ok: true };
}

/** Edit a variation's details while it's still open (draft/submitted). Managers only (RLS). */
export async function updateVariation(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const costImpactCents = Math.round(Number(formData.get('costImpactCents')));
  const timeImpactDays = Math.round(Number(formData.get('timeImpactDays')));
  if (!id || !projectId) return { ok: false, error: 'Missing variation.' };
  if (description.length < 2) return { ok: false, error: 'Describe the change.' };
  if (!Number.isFinite(costImpactCents) || !Number.isFinite(timeImpactDays)) {
    return { ok: false, error: 'Enter valid impacts.' };
  }

  const { data: vo } = await supabase.from('variation_orders').select('status').eq('id', id).maybeSingle();
  const status = (vo as { status: string } | null)?.status;
  if (status === 'approved' || status === 'rejected') {
    return { ok: false, error: 'A decided variation can’t be edited.' };
  }

  const { error } = await supabase
    .from('variation_orders')
    .update({ description, reference: text(formData.get('reference')), cost_impact_cents: costImpactCents, time_impact_days: timeImpactDays })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/variations`);
  return { ok: true };
}

async function decide(
  formData: FormData,
  decision: 'approved' | 'rejected',
): Promise<Result> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing variation.' };

  const { data: vo } = await supabase
    .from('variation_orders')
    .select('org_id, number, description, status, created_by')
    .eq('id', id)
    .maybeSingle();
  const v = vo as { org_id: string; number: number; description: string; status: string; created_by: string | null } | null;
  if (!v) return { ok: false, error: 'Variation not found.' };
  if (v.status !== 'submitted') return { ok: false, error: 'Only a submitted variation can be decided.' };

  const patch =
    decision === 'approved'
      ? { status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(), decided_at: new Date().toISOString() }
      : { status: 'rejected', decided_at: new Date().toISOString() };
  const { error } = await supabase.from('variation_orders').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (v.created_by && v.created_by !== user.id) {
    const by = await actorName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: v.org_id,
      userId: v.created_by,
      type: decision === 'approved' ? 'variation_approved' : 'variation_rejected',
      title: `${by} ${decision} VO #${v.number} — ${await projectName(supabase, projectId)}`,
      body: v.description,
      link: `/projects/${projectId}/variations`,
      entityId: id,
    });
  }

  revalidatePath(`/projects/${projectId}/variations`);
  return { ok: true };
}

export async function approveVariation(formData: FormData): Promise<Result> {
  return decide(formData, 'approved');
}
export async function rejectVariation(formData: FormData): Promise<Result> {
  return decide(formData, 'rejected');
}

export async function deleteVariation(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing variation.' };
  const { error } = await supabase.from('variation_orders').delete().eq('id', id);
  if (error) {
    return { ok: false, error: error.message.includes('approved') ? 'An approved variation is a permanent record and can’t be deleted.' : error.message };
  }
  revalidatePath(`/projects/${projectId}/variations`);
  return { ok: true };
}
