'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { paymentRequestSchema } from '@datumpro/shared/validation';

type Result = { ok: boolean; error?: string };

/** The assigned contractor raises a payment request against an approved task/
 *  plan, with a mandatory invoice. The amount is capped at what's still
 *  claimable (awarded − paid − pending). Only the task's assignee may do this. */
export async function requestPayment(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const parsed = paymentRequestSchema.safeParse({
    projectId: formData.get('projectId'),
    taskId: formData.get('taskId'),
    title: formData.get('title'),
    amountCents: Number(formData.get('amountCents')),
    note: (formData.get('note') as string) || null,
    invoicePath: (formData.get('invoicePath') as string) || null,
    invoiceName: (formData.get('invoiceName') as string) || null,
  });
  if (!parsed.success) return { ok: false, error: 'Pick a task, attach an invoice, and enter a valid amount.' };
  const input = parsed.data;

  // The task is the source of truth — org/project/assignee/amount all come from
  // it, never trusted from the client.
  const { data: task } = await supabase
    .from('tasks')
    .select('org_id, project_id, assignee_id, awarded_cost_cents, plan_approved_at')
    .eq('id', input.taskId)
    .single();
  if (!task) return { ok: false, error: 'Task not found.' };
  if (task.assignee_id !== user.id) return { ok: false, error: 'Only the task assignee can request payment for it.' };
  if (!task.plan_approved_at || (task.awarded_cost_cents ?? 0) <= 0) {
    return { ok: false, error: 'This task has no approved plan amount to invoice yet.' };
  }

  // Cap at what's still claimable: awarded − everything not rejected.
  const { data: reqs } = await supabase
    .from('contractor_payment_requests')
    .select('amount_cents, status')
    .eq('task_id', input.taskId)
    .eq('contractor_id', user.id);
  const used = ((reqs ?? []) as { amount_cents: number; status: string }[])
    .filter((r) => r.status !== 'rejected' && r.status !== 'cancelled')
    .reduce((s, r) => s + r.amount_cents, 0);
  const requestable = (task.awarded_cost_cents ?? 0) - used;
  if (input.amountCents > requestable) {
    return { ok: false, error: `You can request up to $${(requestable / 100).toFixed(2)} more on this task.` };
  }

  const { error } = await supabase.from('contractor_payment_requests').insert({
    org_id: task.org_id,
    project_id: task.project_id,
    task_id: input.taskId,
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

/** The owning contractor withdraws their own still-pending request. This is a
 *  status change to 'cancelled', never a delete — payment records are permanent
 *  (ledger). The DB trigger enforces that only a 'requested' row can move here and
 *  that no money fields change. */
export async function cancelPaymentRequest(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { error } = await supabase
    .from('contractor_payment_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('contractor_id', user.id)
    .eq('status', 'requested');
  if (error) return { ok: false, error: error.message };
  if (projectId) revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

/** Void wrapper so a plain `<form action>` (server component, no client state) can
 *  withdraw a request; revalidation refreshes the list. */
export async function withdrawPaymentRequest(formData: FormData): Promise<void> {
  await cancelPaymentRequest(formData);
}

// approvePaymentRequest retired — payment approval runs through the shared two-step
// chain (decideApprovalStep + finalize_approval flips requested→approved).
//
// reject/pay are DB-enforced transitions (Phase 1b): they go through SECURITY
// DEFINER RPCs that validate state + authority + segregation of duties and write
// their own audit event. The client never sets status/reviewer/payer directly —
// a generic UPDATE of those columns is rejected by the database.

export async function rejectPaymentRequest(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { error } = await supabase.rpc('reject_payment_request', {
    p_id: id,
    p_note: (formData.get('reviewNote') as string) || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

/** Mark a request paid: the DB requires it to be approved, the payer to hold pay
 *  authority and to be neither the contractor nor an approver, and a POP. */
export async function markPaymentRequestPaid(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const { error } = await supabase.rpc('pay_payment_request', {
    p_id: id,
    p_pop_path: (formData.get('popPath') as string) || null,
    p_pop_name: (formData.get('popName') as string) || null,
    p_reference: (formData.get('reference') as string) || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}
