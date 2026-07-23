'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Rename the organisation. RLS restricts organizations UPDATE to owner/admin,
 *  so a non-admin's write is rejected at the database regardless of the UI. */
export async function renameOrganization(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!orgId) throw new Error('Missing organisation');
  if (!name) throw new Error('Organisation name is required');
  if (name.length > 120) throw new Error('That name is too long');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update({ name }).eq('id', orgId);
  if (error) throw new Error(error.message);

  // The name shows in the sidebar switcher too — refresh the whole shell.
  revalidatePath('/', 'layout');
}

const SECOND_APPROVERS = ['admin', 'finance', 'pm', 'viewer', 'none'];

/** Set the org-wide second approver (or 'none' for a single PM-only approval).
 *  The RPC is SECURITY DEFINER and re-checks org-admin, so a non-admin's call is
 *  rejected at the database. Applies uniformly across every approvable type. */
export async function setApprovalPolicy(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const second = String(formData.get('secondApprover') ?? '');
  if (!orgId) throw new Error('Missing organisation');
  if (!SECOND_APPROVERS.includes(second)) throw new Error('Invalid approver');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('set_org_approval_policy', {
    p_org_id: orgId,
    p_second_role: second,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/org');
}
