'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

/** Toggle org-wide MFA requirement. RLS restricts organizations UPDATE to
 *  owner/admin, so a non-admin's write is rejected at the database. */
export async function setOrgMfaRequirement(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const require = String(formData.get('requireMfa') ?? '') === 'on';
  if (!orgId) throw new Error('Missing organisation');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update({ require_mfa: require }).eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({
    orgId,
    actorId: user.id,
    entityType: 'organization',
    entityId: orgId,
    action: require ? 'mfa.required_enabled' : 'mfa.required_disabled',
  });
  revalidatePath('/org');
}
