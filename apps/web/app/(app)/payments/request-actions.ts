'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { paymentRequestSchema } from '@datumpro/shared/validation';

type Result = { ok: boolean; error?: string };

/** Contractor raises a payment request (against a draw or ad-hoc). */
export async function requestPayment(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const parsed = paymentRequestSchema.safeParse({
    projectId: formData.get('projectId'),
    scheduleId: (formData.get('scheduleId') as string) || null,
    title: formData.get('title'),
    amountCents: Number(formData.get('amountCents')),
    note: (formData.get('note') as string) || null,
    invoicePath: (formData.get('invoicePath') as string) || null,
    invoiceName: (formData.get('invoiceName') as string) || null,
  });
  if (!parsed.success) return { ok: false, error: 'Please check the amount and title.' };
  const input = parsed.data;

  // org_id comes from the project — never trusted from the client.
  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', input.projectId)
    .single();
  if (!project) return { ok: false, error: 'Project not found.' };

  const { error } = await supabase.from('contractor_payment_requests').insert({
    org_id: project.org_id,
    project_id: input.projectId,
    schedule_id: input.scheduleId,
    contractor_id: user.id,
    title: input.title,
    amount_cents: input.amountCents,
    note: input.note,
    invoice_path: input.invoicePath,
    invoice_name: input.invoiceName,
    status: 'requested',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/payments');
  return { ok: true };
}

async function managerUpdate(
  id: string,
  patch: Record<string, unknown>,
  projectId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from('contractor_payment_requests').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

// approvePaymentRequest retired — payment approval now runs through the shared
// two-step chain (decideApprovalStep + finalize_approval flips requested→approved).

export async function rejectPaymentRequest(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  return managerUpdate(
    id,
    {
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: (formData.get('reviewNote') as string) || null,
    },
    projectId,
  );
}

/** Mark a request paid, attach a POP, and sync a linked draw to paid. */
export async function markPaymentRequestPaid(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const reference = (formData.get('reference') as string) || null;
  const popPath = (formData.get('popPath') as string) || null;
  const popName = (formData.get('popName') as string) || null;
  const paidAt = new Date().toISOString();

  const res = await managerUpdate(
    id,
    {
      status: 'paid',
      paid_at: paidAt,
      paid_by: user.id,
      paid_reference: reference,
      pop_path: popPath,
      pop_name: popName,
    },
    projectId,
  );
  if (!res.ok) return res;

  // If this request covers a scheduled draw, mark that draw paid too so the
  // contractor's "My payments" totals stay consistent.
  const { data: row } = await supabase
    .from('contractor_payment_requests')
    .select('schedule_id')
    .eq('id', id)
    .single();
  if (row?.schedule_id) {
    await supabase
      .from('payment_schedule')
      .update({ status: 'paid', paid_at: paidAt, paid_reference: reference })
      .eq('id', row.schedule_id);
  }
  return { ok: true };
}
