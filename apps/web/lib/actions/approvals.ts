'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

/** Decide one step of an approval chain (any entity type — extension, payment,
 *  variation, request). The DB finalizes the entity + applies its effect once
 *  every step is approved; SoD blocks approving your own item. The caller passes
 *  the page `path` to revalidate. Shared by web (and mirrored on mobile). */
export async function decideApprovalStep(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const approvalId = String(formData.get('approvalId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const path = String(formData.get('path') ?? '');
  if (decision !== 'approved' && decision !== 'rejected') return;

  const { data: row, error } = await supabase
    .from('approvals')
    .update({
      decision,
      approver_id: user.id,
      comment: (formData.get('comment') as string) || null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    .select('org_id')
    .single();
  if (error) {
    throw new Error(
      error.message.includes('segregation of duties')
        ? 'You cannot approve your own request'
        : error.message,
    );
  }
  await logAudit({
    orgId: (row as { org_id: string } | null)?.org_id ?? '',
    actorId: user.id,
    entityType: 'approval',
    entityId: approvalId,
    action: `approval.${decision}`,
  });
  if (path) revalidatePath(path);
}
