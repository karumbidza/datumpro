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

  // Cap at what's unlocked by progress, net of retention, minus what's already
  // claimed. Mirrors enforce_payment_request_insert (the DB is the hard gate).
  const [{ data: reqs }, { data: entitlement }] = await Promise.all([
    supabase
      .from('contractor_payment_requests')
      .select('amount_cents, status')
      .eq('task_id', input.taskId)
      .eq('contractor_id', user.id),
    supabase.rpc('task_payment_entitlement_cents', { p_task_id: input.taskId }),
  ]);
  const used = ((reqs ?? []) as { amount_cents: number; status: string }[])
    .filter((r) => r.status !== 'rejected' && r.status !== 'cancelled')
    .reduce((s, r) => s + r.amount_cents, 0);
  const requestable = Math.max(0, ((entitlement as number | null) ?? 0) - used);
  if (input.amountCents > requestable) {
    return {
      ok: false,
      error:
        requestable <= 0
          ? 'Nothing is claimable yet — payment unlocks as the task progresses (25/50/75/90/100%) and retention is held back.'
          : `You can request up to $${(requestable / 100).toFixed(2)} more at this stage.`,
    };
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

/** The contractor claims their held retention back once the defects-liability
 *  period has elapsed. One project-level request (no task) for up to the net
 *  retention still owed, with a mandatory invoice. The DB re-checks releasability
 *  and the cap in enforce_payment_request_insert; this mirrors it for a clean error. */
export async function requestRetentionRelease(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim() || 'Retention release';
  const amountCents = Number(formData.get('amountCents'));
  const invoicePath = (formData.get('invoicePath') as string) || null;
  const invoiceName = (formData.get('invoiceName') as string) || null;
  const note = (formData.get('note') as string)?.trim() || null;
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { ok: false, error: 'Enter a valid amount.' };
  if (!invoicePath) return { ok: false, error: 'Attach your invoice to proceed.' };

  // org_id is the project's — never trusted from the client.
  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const orgId = (proj as { org_id: string } | null)?.org_id;
  if (!orgId) return { ok: false, error: 'Project not found.' };

  const [{ data: releasable }, { data: available }] = await Promise.all([
    supabase.rpc('project_retention_releasable', { p_project_id: projectId }),
    supabase.rpc('project_contractor_retention_available_cents', { p_project_id: projectId, p_contractor: user.id }),
  ]);
  if (!releasable) {
    return { ok: false, error: 'Retention is not releasable yet — the defects-liability period has not elapsed.' };
  }
  const avail = (available as number | null) ?? 0;
  if (avail <= 0) return { ok: false, error: 'No retention is available to release on this project.' };
  if (amountCents > avail) return { ok: false, error: `You can release up to $${(avail / 100).toFixed(2)}.` };

  const { error } = await supabase.from('contractor_payment_requests').insert({
    org_id: orgId,
    project_id: projectId,
    task_id: null,
    kind: 'retention',
    contractor_id: user.id,
    title,
    amount_cents: amountCents,
    note,
    invoice_path: invoicePath,
    invoice_name: invoiceName,
    status: 'requested',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/payments');
  revalidatePath(`/projects/${projectId}/finance`);
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
