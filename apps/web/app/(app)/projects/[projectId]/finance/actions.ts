'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

/** A manager (PM / org finance / staff) records retention spent on repairs for a
 *  contractor's poor workmanship during the defects-liability period. It reduces
 *  what that contractor can eventually release. Enforced by the record_retention_
 *  deduction RPC (authority + immutable ledger + audit). */
export async function recordRetentionDeduction(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const projectId = String(formData.get('projectId') ?? '');
  const contractorId = String(formData.get('contractorId') ?? '');
  const amountCents = Number(formData.get('amountCents'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!projectId || !contractorId) return { ok: false, error: 'Missing project or contractor.' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { ok: false, error: 'Enter a valid amount.' };
  if (!reason) return { ok: false, error: 'A reason is required.' };

  const { error } = await supabase.rpc('record_retention_deduction', {
    p_project: projectId,
    p_contractor: contractorId,
    p_amount: amountCents,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

/** A manager (PM / org finance / staff) issues an advance to a contractor on a
 *  project. It's recorded (immutable + audited) and recouped from their progress
 *  claims. Enforced by the issue_contractor_advance RPC. */
export async function issueContractorAdvance(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const projectId = String(formData.get('projectId') ?? '');
  const contractorId = String(formData.get('contractorId') ?? '');
  const amountCents = Number(formData.get('amountCents'));
  const reference = (formData.get('reference') as string)?.trim() || null;
  const note = (formData.get('note') as string)?.trim() || null;
  if (!projectId || !contractorId) return { ok: false, error: 'Missing project or contractor.' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { ok: false, error: 'Enter a valid amount.' };

  const { error } = await supabase.rpc('issue_contractor_advance', {
    p_project: projectId,
    p_contractor: contractorId,
    p_amount: amountCents,
    p_reference: reference,
    p_note: note,
  });
  if (error) return { ok: false, error: error.message };

  // Tell the contractor — the advance offsets their upcoming progress claims.
  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const p = proj as { org_id: string; name: string } | null;
  if (p) {
    const usd = (amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    await notifyUser(supabase, {
      orgId: p.org_id,
      userId: contractorId,
      type: 'advance_issued',
      title: `Advance issued — ${p.name}`,
      body: `An advance of ${usd} was issued to you. It will be recouped from your progress claims as tasks complete.`,
      link: '/payments',
      entityId: projectId,
    });
  }

  revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}

/** Cancel an advance issued in error (the row is never deleted). Frees any cash it
 *  was offsetting. PM / org finance / staff. */
export async function cancelContractorAdvance(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const advanceId = String(formData.get('advanceId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const reason = (formData.get('reason') as string)?.trim() || null;
  if (!advanceId) return { ok: false, error: 'Missing advance.' };

  const { error } = await supabase.rpc('cancel_contractor_advance', { p_advance: advanceId, p_reason: reason });
  if (error) return { ok: false, error: error.message };

  if (projectId) revalidatePath(`/projects/${projectId}/finance`);
  revalidatePath('/payments');
  return { ok: true };
}
