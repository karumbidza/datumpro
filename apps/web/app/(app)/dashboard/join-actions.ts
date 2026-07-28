'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE } from '@/lib/data/org';
import { logAudit } from '@/lib/audit';

/** Join an org whose verified domain matches the signed-in user's email. The RPC
 *  re-checks the domain server-side and adds the user at the lowest role. */
export async function joinOrgByDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('join_org_by_domain', { p_org_id: orgId });
  if (error) redirect('/dashboard?joinerror=' + encodeURIComponent(error.message));

  await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: user.id, action: 'member.joined_by_domain' });

  // Make the joined org active and land in it.
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
