'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createRequestSchema } from '@datumpro/shared/validation';

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

export async function createRequest(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const amountRaw = formData.get('amount');
  const amountCents = amountRaw ? Math.round(Number(amountRaw) * 100) : undefined;

  const parsed = createRequestSchema.safeParse({
    projectId,
    type: String(formData.get('type') ?? 'rfi'),
    title: String(formData.get('title') ?? ''),
    description: (formData.get('description') as string) || undefined,
    amountCents,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(', '));

  const { data: project } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (!project) throw new Error('Project not found or access denied');

  const { data: created, error } = await supabase
    .from('requests')
    .insert({
      org_id: (project as { org_id: string }).org_id,
      project_id: projectId,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      amount_cents: parsed.data.amountCents ?? null,
      raised_by: user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/requests`);
  redirect(`/projects/${projectId}/requests/${(created as { id: string }).id}`);
}

/** Submit a draft → materialises the approval chain from policy (DB function). */
export async function submitRequest(formData: FormData) {
  const { supabase } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const { error } = await supabase.rpc('submit_request', { p_request_id: requestId });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/requests/${requestId}`);
}

export async function decideApproval(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const approvalId = String(formData.get('approvalId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('Invalid decision');

  const { error } = await supabase
    .from('approvals')
    .update({
      decision,
      approver_id: user.id,
      comment: (formData.get('comment') as string) || null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId);
  if (error) {
    throw new Error(
      error.message.includes('segregation of duties')
        ? 'You cannot approve your own request'
        : error.message,
    );
  }
  // The finalize trigger updates the request status automatically.
  revalidatePath(`/projects/${projectId}/requests/${requestId}`);
}
