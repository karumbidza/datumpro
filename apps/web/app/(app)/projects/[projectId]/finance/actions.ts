'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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
