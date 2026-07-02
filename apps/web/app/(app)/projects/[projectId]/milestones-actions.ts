'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const STATUSES = ['pending', 'in_progress', 'done', 'missed'] as const;
type MilestoneStatus = (typeof STATUSES)[number];

function parseStatus(v: FormDataEntryValue | null): MilestoneStatus {
  const s = String(v ?? '');
  if (!(STATUSES as readonly string[]).includes(s)) throw new Error('Invalid milestone status');
  return s as MilestoneStatus;
}

/** Add a milestone. RLS (org owner/admin/pm) rejects anyone else. */
export async function addMilestone(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const targetDate = String(formData.get('targetDate') ?? '') || null;
  if (!projectId || !name) throw new Error('A milestone name is required');

  const supabase = await createClient();
  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) throw new Error('Project not found');

  const { error } = await supabase.from('milestones').insert({
    org_id: (project as { org_id: string }).org_id,
    project_id: projectId,
    name,
    target_date: targetDate,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function setMilestoneStatus(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  const status = parseStatus(formData.get('status'));
  if (!id) throw new Error('Missing milestone');
  const supabase = await createClient();
  const { error } = await supabase.from('milestones').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function updateMilestone(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const targetDate = String(formData.get('targetDate') ?? '') || null;
  if (!id || !name) throw new Error('A milestone name is required');
  const supabase = await createClient();
  const { error } = await supabase
    .from('milestones')
    .update({ name, target_date: targetDate })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteMilestone(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing milestone');
  const supabase = await createClient();
  const { error } = await supabase.from('milestones').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
